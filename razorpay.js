const Razorpay = require('razorpay');
const crypto = require('crypto');
const { sql, poolPromise } = require('./dbConfig');
const multer = require('multer');
const path = require('path');

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Configure multer for file storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname))
  }
});

const upload = multer({ storage: storage });

const verifyToken = require('./authMiddleware');

const registerRazorpayRoutes = (app) => {
  // ---------------- Create Razorpay Order ----------------
  app.post('/api/create-order', verifyToken, async (req, res) => {
    try {
      const { formId } = req.body;

      if (!formId) {
        return res.status(400).json({ error: 'FormId is required' });
      }

      const pool = await poolPromise;
      const result = await pool.request()
        .input('FormId', sql.Int, formId)
        .query('SELECT Fee FROM FormMaster_dtl WHERE FormId = @FormId');

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Form not found or no fee associated' });
      }

      const amount = result.recordset[0].Fee * 100; // Razorpay expects paise
      const currency = 'INR';

      const options = {
        amount,
        currency,
        receipt: `receipt_order_${new Date().getTime()}`,
      };

      const order = await razorpay.orders.create(options);
      res.json({ success: true, order: { ...order, formId } });

    } catch (error) {
      console.error('Create Order Error:', error);
      // Send a more detailed error message to the client for debugging
      res.status(500).json({ message: 'Error creating order', details: error.message });
    }
  });

  // ---------------- Verify Razorpay Payment ----------------
  app.post('/api/verify-payment', [verifyToken, upload.any()], async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, formId, ...values } = req.body;
    const emailOrPhoneNo = req.user.UserId;

    const pool = await poolPromise;
    const transaction = pool.transaction();

    try {
      await transaction.begin();

      // Get User ID from email/phone
      const userResult = await transaction.request()
        .input("Emailormobileno", sql.NVarChar, String(emailOrPhoneNo))
        .query(`SELECT Id FROM FormRegister_dtl WHERE Emailormobileno = @Emailormobileno`);

      if (userResult.recordset.length === 0) {
        throw new Error("User not found in FormRegister_dtl");
      }
      const userId = userResult.recordset[0].Id;

      // Step 1: Verify Razorpay Signature
      const shasum = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
      shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
      const digest = shasum.digest('hex');

      if (digest !== razorpay_signature) {
        return res.status(400).json({ error: 'Invalid signature' });
      }

      // Step 2: Create Submission (with file handling)
      const submissionId = Date.now();
      
      // Parse columnValues from JSON string
      const columnValues = JSON.parse(values.columnValues || '{}');

      const allValues = { ...columnValues };
      if (req.files) {
        req.files.forEach(file => {
          allValues[file.fieldname] = `/uploads/${file.filename}`;
        });
      }

      for (const colId in allValues) {
        if (Object.hasOwnProperty.call(allValues, colId)) {
          let value = allValues[colId];
          if (typeof value === "boolean") value = value ? "1" : "0";

          await transaction
            .request()
            .input("FormId", sql.Int, formId)
            .input("ColId", sql.Int, colId)
            .input("SubmissionId", sql.BigInt, submissionId)
            .input("ColumnValues", sql.NVarChar(sql.MAX), String(value ?? ""))
            .input("EmailorPhoneno", sql.Int, userId)
            .input("Active", sql.Bit, 1)
            .query(`
              INSERT INTO FormValues_dtl (FormId, ColId, SubmissionId, ColumnValues, EmailorPhoneno, Active)
              VALUES (@FormId, @ColId, @SubmissionId, @ColumnValues, @EmailorPhoneno, @Active);
            `);
        }
      }

      // Step 3: Get Fee
      const result = await transaction.request()
        .input('FormId', sql.Int, formId)
        .query('SELECT Fee FROM FormMaster_dtl WHERE FormId = @FormId');

      if (result.recordset.length === 0) {
        throw new Error('Form not found');
      }
      const amount = result.recordset[0].Fee;

      // Step 4: Insert Payment details
      await transaction.request()
        .input('FormId', sql.Int, formId)
        .input('SubmissionId', sql.BigInt, submissionId)
        .input('UserId', sql.Int, userId)
        .input('RazorpayOrderId', sql.VarChar, razorpay_order_id)
        .input('RazorpayPaymentId', sql.VarChar, razorpay_payment_id)
        .input('RazorpaySignature', sql.VarChar, razorpay_signature)
        .input('Amount', sql.Decimal(10, 2), amount)
        .input('Currency', sql.VarChar, 'INR')
        .input('Status', sql.VarChar, 'captured')
        .input('PaymentDate', sql.DateTime, new Date())
        .input('Active', sql.Bit, 1)
        .query(`
          INSERT INTO Payments_dtl (FormId, SubmissionId, UserId, RazorpayOrderId, RazorpayPaymentId, RazorpaySignature, Amount, Currency, Status, PaymentDate, Active)
          VALUES (@FormId, @SubmissionId, @UserId, @RazorpayOrderId, @RazorpayPaymentId, @RazorpaySignature, @Amount, @Currency, @Status, @PaymentDate, @Active)
        `);

      await transaction.commit();
      res.json({ success: true, message: 'Payment verified, form submitted successfully', submissionId });

    } catch (error) {
      await transaction.rollback();
      console.error('Verify Payment Error:', error);
      // Send a more detailed error message to the client for debugging
      res.status(500).json({ message: 'Error verifying payment', details: error.message });
    }
  });
};

module.exports = { razorpay, registerRazorpayRoutes };
