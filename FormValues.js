const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("./dbConfig");
const verifyToken = require('./authMiddleware');
const multer = require('multer');
const path = require('path');
const cloudinary = require('./cloudinary');
const streamifier = require('streamifier');
const pdf = require('pdf-parse'); // Import pdf-parse

// Helper function to validate PDF page count from a buffer
const validatePdfPageCount = async (buffer) => {
  try {
    const pdfData = await pdf(buffer);
    const pageCount = pdfData.numpages;

    if (pageCount >= 2 && pageCount <= 3) {
      return { isValid: true, message: "" };
    } else {
      return { isValid: false, message: "PDF must be between 2 and 3 pages." };
    }
  } catch (error) {
    console.error("Error parsing PDF for page count:", error);
    return { isValid: false, message: "Could not validate PDF page count." };
  }
};

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ✅ POST: Submit form data
router.post("/submit", upload.any(), async (req, res) => {
  const { formId, ...values } = req.body;
  const emailOrPhoneNo = req.headers["userid"];
  const submissionId = Date.now();

  if (!formId || (!values && !req.files)) {
    return res.status(400).json({ message: "Form ID and values are required." });
  }
  if (!emailOrPhoneNo) {
    return res.status(400).json({ message: "User identifier (email/phone) is required." });
  }

  const pool = await poolPromise;
  const transaction = pool.transaction();

  try {
    await transaction.begin();
    
    // Check if the form requires payment
    const feeResult = await transaction.request()
      .input("FormId", sql.Int, formId)
      .query(`SELECT Fee FROM FormMaster_dtl WHERE FormId = @FormId`);

    if (feeResult.recordset.length > 0 && feeResult.recordset[0].Fee > 0) {
      // This form requires payment, so we should not submit it here.
      // The submission should happen through the payment verification endpoint.
      await transaction.rollback();
      return res.status(402).json({ 
        message: "Payment required. Please use the payment flow to submit.",
        paymentRequired: true 
      });
    }


    // 🔹 Get UserId (Id) from FormRegister_dtl
    const userResult = await transaction.request()
      .input("Emailormobileno", sql.NVarChar, emailOrPhoneNo)
      .query(`SELECT Id FROM FormRegister_dtl WHERE Emailormobileno = @Emailormobileno`);

    if (userResult.recordset.length === 0) {
      throw new Error("User not found in FormRegister_dtl");
    }
    const userId = userResult.recordset[0].Id;

    // 🔹 Fetch column details to get DataType for validation
    const columnsResponse = await transaction.request()
      .input("FormId", sql.Int, formId)
      .query(`
        SELECT dc.Id AS ColId, dc.DataType
        FROM FormDetails_dtl fd
        INNER JOIN DynamicColumns dc ON fd.ColId = dc.Id
        WHERE fd.FormId = @FormId AND fd.Active = 1
      `);
    const formColumns = columnsResponse.recordset;

    // Combine body values and file values
    const allValues = { ...values };
    if (req.files) {
      const uploadPromises = req.files.map(file => {
        return new Promise(async (resolve, reject) => {
          try {
            const colId = parseInt(file.fieldname, 10);
            const column = formColumns.find(c => c.ColId === colId);

            // Validate PDF page count from buffer
            if (column && column.DataType?.toLowerCase() === 'file' && file.mimetype === 'application/pdf') {
              const { isValid, message } = await validatePdfPageCount(file.buffer);
              if (!isValid) {
                // Reject the promise if validation fails
                return reject(new Error(message));
              }
            }

            // Upload to Cloudinary
            const uploadStream = cloudinary.uploader.upload_stream(
              { resource_type: 'auto', folder: 'form_submissions' },
              (error, result) => {
                if (error) {
                  return reject(error);
                }
                allValues[file.fieldname] = result.secure_url;
                resolve();
              }
            );

            streamifier.createReadStream(file.buffer).pipe(uploadStream);

          } catch (uploadError) {
            reject(uploadError);
          }
        });
      });

      try {
        // Wait for all file uploads to complete
        await Promise.all(uploadPromises);
      } catch (error) {
        // If any upload or validation fails, rollback the transaction
        await transaction.rollback();
        // Provide specific feedback for PDF validation errors
        if (error.message.includes("PDF must be between")) {
            return res.status(400).json({ message: error.message });
        }
        // Generic error for other upload failures
        console.error("Error uploading files to Cloudinary:", error);
        return res.status(500).json({ message: "Error uploading one or more files." });
      }
    }

    // 🔹 Insert values
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

    await transaction.commit();
    res.status(201).json({
      message: "Form submitted successfully!",
      submissionId,
    });
  } catch (err) {
    await transaction.rollback();
    console.error("Error submitting form values:", err);
    res.status(500).json({ message: "Server error while submitting form." });
  }
});

// ✅ PUT: Update form values
router.put("/values/:submissionId", upload.any(), async (req, res) => {
  const { submissionId } = req.params;
  const { formId, ...restOfBody } = req.body;
  const emailOrPhoneNo = req.headers["userid"];

  if (!formId || !restOfBody || Object.keys(restOfBody).length === 0) {
    return res.status(400).json({ message: "Form ID and values are required." });
  }
  if (!submissionId) {
    return res.status(400).json({ message: "Submission ID is required." });
  }
  if (!emailOrPhoneNo) {
    return res.status(400).json({ message: "User identifier (email/phone) is required." });
  }

  const pool = await poolPromise;
  const transaction = pool.transaction();

  try {
    await transaction.begin();

    // 🔹 Get UserId from FormRegister_dtl
    const userResult = await transaction.request()
      .input("Emailormobileno", sql.NVarChar, emailOrPhoneNo)
      .query(`SELECT Id FROM FormRegister_dtl WHERE Emailormobileno = @Emailormobileno`);

    if (userResult.recordset.length === 0) {
      throw new Error("User not found in FormRegister_dtl");
    }
    const userId = userResult.recordset[0].Id;

    // 🔹 Fetch column details to get DataType for validation
    const columnsResponse = await transaction.request()
      .input("FormId", sql.Int, formId)
      .query(`
        SELECT dc.Id AS ColId, dc.DataType
        FROM FormDetails_dtl fd
        INNER JOIN DynamicColumns dc ON fd.ColId = dc.Id
        WHERE fd.FormId = @FormId AND fd.Active = 1
      `);
    const formColumns = columnsResponse.recordset;

    // Combine body values and file values
    const allValues = { ...restOfBody };
    if (req.files) {
      const uploadPromises = req.files.map(file => {
        return new Promise(async (resolve, reject) => {
          try {
            const colId = parseInt(file.fieldname, 10);
            const column = formColumns.find(c => c.ColId === colId);

            // Validate PDF page count from buffer
            if (column && column.DataType?.toLowerCase() === 'file' && file.mimetype === 'application/pdf') {
              const { isValid, message } = await validatePdfPageCount(file.buffer);
              if (!isValid) {
                // Reject the promise if validation fails
                return reject(new Error(message));
              }
            }

            // Upload to Cloudinary
            const uploadStream = cloudinary.uploader.upload_stream(
              { resource_type: 'auto', folder: 'form_submissions' },
              (error, result) => {
                if (error) {
                  return reject(error);
                }
                allValues[file.fieldname] = result.secure_url;
                resolve();
              }
            );

            streamifier.createReadStream(file.buffer).pipe(uploadStream);

          } catch (uploadError) {
            reject(uploadError);
          }
        });
      });

      try {
        // Wait for all file uploads to complete
        await Promise.all(uploadPromises);
      } catch (error) {
        // If any upload or validation fails, rollback the transaction
        await transaction.rollback();
        // Provide specific feedback for PDF validation errors
        if (error.message.includes("PDF must be between")) {
            return res.status(400).json({ message: error.message });
        }
        // Generic error for other upload failures
        console.error("Error uploading files to Cloudinary:", error);
        return res.status(500).json({ message: "Error uploading one or more files." });
      }
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
          .input("UserId", sql.Int, userId)
          .input("ColumnValues", sql.NVarChar(sql.MAX), String(value ?? ""))
          .query(`
            UPDATE FormValues_dtl 
            SET ColumnValues = @ColumnValues
            WHERE FormId = @FormId 
              AND ColId = @ColId 
              AND SubmissionId = @SubmissionId
              AND EmailorPhoneno = @UserId
              AND Active = 1;
          `);
      }
    }

    await transaction.commit();
    res.status(200).json({ message: "Form values updated successfully!" });
  } catch (err) {
    console.log(err);
    await transaction.rollback();
    console.error("Error updating form values:", err);
    res.status(500).json({ message: "Server error while updating form values." });
  }
});

// ✅ GET: Retrieve form values
router.get("/values", async (req, res) => {
  const { formId } = req.query;
  const emailOrPhoneNo = req.headers["userid"];

  if (!formId) {
    return res.status(400).json({ message: "Form ID is required." });
  }
  if (!emailOrPhoneNo) {
    return res.status(400).json({ message: "User identifier (email/phone) is required." });
  }

  try {
    const pool = await poolPromise;

    // 🔹 Get UserId from FormRegister_dtl
    const userResult = await pool.request()
      .input("Emailormobileno", sql.NVarChar, emailOrPhoneNo)
      .query(`SELECT Id FROM FormRegister_dtl WHERE Emailormobileno = @Emailormobileno`);

    if (userResult.recordset.length === 0) {
      return res.status(404).json({ message: "User not found in FormRegister_dtl" });
    }
    const userId = userResult.recordset[0].Id;

    // 🔹 Get form values with join
    const result = await pool.request()
      .input("FormId", sql.Int, formId)
      .input("UserId", sql.Int, userId)
      .query(`
        SELECT 
          fv.SubmissionId,
          fv.ColId,
          fv.ColumnValues,
          dc.ColumnName,
          dc.DataType,
          fm.FormName,
          fr.Emailormobileno
        FROM FormValues_dtl fv
        INNER JOIN DynamicColumns dc ON fv.ColId = dc.Id
        INNER JOIN FormMaster_dtl fm ON fv.FormId = fm.FormId
        INNER JOIN FormRegister_dtl fr ON fv.EmailorPhoneno = fr.Id
        WHERE fv.FormId = @FormId 
          AND fv.EmailorPhoneno = @UserId
          AND fv.Active = 1
        ORDER BY fv.SubmissionId, fv.Id;
      `);

    if (result.recordset.length === 0) {
      return res.status(200).json([]);
    }

    // 🔹 Get form column definitions regardless of submissions
    const columnsResult = await pool.request()
      .input("FormId", sql.Int, formId)
      .query(`
        SELECT DISTINCT dc.Id as ColId, dc.ColumnName, dc.DataType, fd.SequenceNo
        FROM FormDetails_dtl fd
        JOIN DynamicColumns dc ON fd.ColId = dc.Id
        WHERE fd.FormId = @FormId
        ORDER BY fd.SequenceNo
      `);

    // 🔹 Group by SubmissionId
    const submissionsMap = result.recordset.reduce((acc, row) => {
      if (!acc[row.SubmissionId]) {
        acc[row.SubmissionId] = {
          SubmissionId: row.SubmissionId,
          Emailormobileno: row.Emailormobileno,
          values: {},
        };
      }
      acc[row.SubmissionId].values[row.ColId] = row.ColumnValues;
      return acc;
    }, {});

    const responsePayload = [
      {
        formName: result.recordset[0].FormName,
        columns: columnsResult.recordset,
        submissions: Object.values(submissionsMap),
      },
    ];

    res.status(200).json(responsePayload);
  } catch (err) {
    console.error("Error fetching form values:", err);
    res.status(500).json({ message: "Server error while fetching values." });
  }
});

// ✅ GET: Retrieve ALL form values (without user filtering)
router.get("/values/all", async (req, res) => {
  const { formId } = req.query;

  if (!formId) {
    return res.status(400).json({ message: "Form ID is required." });
  }

  try {
    const pool = await poolPromise;

    // 🔹 Get form values with join (no user filter)
    const result = await pool.request()
      .input("FormId", sql.Int, formId)
      .query(`
        SELECT 
          fv.SubmissionId,
          fv.ColId,
          fv.ColumnValues,
          dc.ColumnName,
          dc.DataType,
          fm.FormName,
          fr.Emailormobileno
        FROM FormValues_dtl fv
        INNER JOIN DynamicColumns dc ON fv.ColId = dc.Id
        INNER JOIN FormMaster_dtl fm ON fv.FormId = fm.FormId
        INNER JOIN FormRegister_dtl fr ON fv.EmailorPhoneno = fr.Id
        WHERE fv.FormId = @FormId 
          AND fv.Active = 1
        ORDER BY fv.SubmissionId, fv.Id;
      `);

    // 🔹 Get form column definitions regardless of submissions
    const columnsResult = await pool.request()
      .input("FormId", sql.Int, formId)
      .query(`
        SELECT DISTINCT dc.Id as ColId, dc.ColumnName, dc.DataType, fd.SequenceNo
        FROM FormDetails_dtl fd
        JOIN DynamicColumns dc ON fd.ColId = dc.Id
        WHERE fd.FormId = @FormId
        ORDER BY fd.SequenceNo
      `);

    if (result.recordset.length === 0) {
      const formNameResult = await pool.request()
        .input("FormId", sql.Int, formId)
        .query(`SELECT FormName FROM FormMaster_dtl WHERE FormId = @FormId`);
      
      const formName = formNameResult.recordset.length > 0 ? formNameResult.recordset[0].FormName : 'Unknown Form';

      return res.status(200).json([{
        formName: formName,
        columns: columnsResult.recordset,
        submissions: []
      }]);
    }

    // 🔹 Group by SubmissionId
    const submissionsMap = result.recordset.reduce((acc, row) => {
      if (!acc[row.SubmissionId]) {
        acc[row.SubmissionId] = {
          SubmissionId: row.SubmissionId,
          Emailormobileno: row.Emailormobileno,
          values: {},
        };
      }
      acc[row.SubmissionId].values[row.ColId] = row.ColumnValues;
      return acc;
    }, {});

    const responsePayload = [
      {
        formName: result.recordset[0].FormName,
        columns: columnsResult.recordset,
        submissions: Object.values(submissionsMap),
      },
    ];

    res.status(200).json(responsePayload);
  } catch (err) {
    console.error("Error fetching all form values:", err);
    res.status(500).json({ message: "Server error while fetching all values." });
  }
});

// ✅ GET: Retrieve form values by EmailorPhoneno
router.get("/values/by-email", verifyToken, async (req, res) => {
  const { emailOrPhoneNo } = req.query; // pass ?emailOrPhoneNo=xxx

  if (!emailOrPhoneNo) {
    return res.status(400).json({ message: "Email or Phone number is required." });
  }

  try {
    const pool = await poolPromise;

    const userResult = await pool.request()
      .input("Emailormobileno", sql.NVarChar, emailOrPhoneNo)
      .query(`SELECT Id FROM FormRegister_dtl WHERE Emailormobileno = @Emailormobileno`);

    if (userResult.recordset.length === 0) {
      return res.status(404).json({ message: "User not found in FormRegister_dtl" });
    }
    const userId = userResult.recordset[0].Id;

    // 🔹 Get form values with join
    const valuesResult = await pool.request()
      .input("UserId", sql.Int, userId)
      .query(`
        SELECT 
            fr.Emailormobileno,
            fv.SubmissionId,
            fv.ColId,
            fv.ColumnValues,
            dc.ColumnName,
            dc.DataType,
            fm.FormName,
            fm.FormId
        FROM FormValues_dtl fv
        INNER JOIN DynamicColumns dc ON fv.ColId = dc.Id
        INNER JOIN FormMaster_dtl fm ON fv.FormId = fm.FormId
        INNER JOIN FormRegister_dtl fr ON fv.EmailorPhoneno = fr.Id
        WHERE fv.Active = 1
          AND fv.EmailorPhoneno = @UserId
        ORDER BY fv.FormId, fv.SubmissionId, fv.Id;
      `);

    if (valuesResult.recordset.length === 0) {
      return res.status(200).json([]);
    }

    // 🔹 Group by FormId and SubmissionId
    const formsMap = {};
    
    valuesResult.recordset.forEach(row => {
      const formKey = `${row.FormId}`;
      if (!formsMap[formKey]) {
        formsMap[formKey] = {
          formId: row.FormId,
          formName: row.formName,
          Emailormobileno: row.Emailormobileno,
          submissions: {}
        };
      }
      
      if (!formsMap[formKey].submissions[row.SubmissionId]) {
        formsMap[formKey].submissions[row.SubmissionId] = {
          SubmissionId: row.SubmissionId,
          values: {},
        };
      }
      
      formsMap[formKey].submissions[row.SubmissionId].values[row.ColId] = row.ColumnValues;
    });

    // Convert to response format
    const responsePayload = Object.values(formsMap).map(form => ({
      formId: form.formId,
      formName: form.formName,
      Emailormobileno: form.Emailormobileno,
      submissions: Object.values(form.submissions)
    }));

    res.status(200).json(responsePayload);
  } catch (err) {
    console.error("Error fetching values by EmailorPhoneno:", err);
    res.status(500).json({ message: "Server error while fetching values by email/phone." });
  }
});

// ✅ GET: Check if a user has already submitted a form
router.get("/check-submission", async (req, res) => {
  const { formId } = req.query;
  const emailOrPhoneNo = req.headers["userid"];

  if (!formId) {
    return res.status(400).json({ message: "Form ID is required." });
  }
  if (!emailOrPhoneNo) {
    return res.status(400).json({ message: "User identifier (email/phone) is required." });
  }

  try {
    const pool = await poolPromise;

    // 🔹 Get UserId from FormRegister_dtl
    const userResult = await pool.request()
      .input("Emailormobileno", sql.NVarChar, emailOrPhoneNo)
      .query(`SELECT Id FROM FormRegister_dtl WHERE Emailormobileno = @Emailormobileno`);

    if (userResult.recordset.length === 0) {
      // User not found in registration, so definitely no form submission
      return res.status(200).json({ hasSubmission: false });
    }
    const userId = userResult.recordset[0].Id;

    // 🔹 Check for existing active submissions for this form and user
    const submissionCheck = await pool.request()
      .input("FormId", sql.Int, formId)
      .input("UserId", sql.Int, userId)
      .query(`
        SELECT TOP 1 SubmissionId
        FROM FormValues_dtl
        WHERE FormId = @FormId
          AND EmailorPhoneno = @UserId
          AND Active = 1;
      `);

    if (submissionCheck.recordset.length > 0) {
      return res.status(200).json({
        hasSubmission: true,
        submissionId: submissionCheck.recordset[0].SubmissionId,
      });
    } else {
      return res.status(200).json({ hasSubmission: false });
    }
  } catch (err) {
    console.error("Error checking form submission existence:", err);
    res.status(500).json({ message: "Server error while checking form submission." });
  }
});



module.exports = router;