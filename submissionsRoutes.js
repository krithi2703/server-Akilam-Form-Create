const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('./dbConfig');
const verifyToken = require('./authMiddleware'); // Make sure verifyToken is included

// This route now gets submissions for the logged-in user
router.get('/', verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('UserId', sql.Int, req.user.UserId) // Get UserId from token
      .query(`
        SELECT
          fv.SubmissionId,
          fr.Emailormobileno,
          reg.Name AS UserName,
          pd.RazorpayPaymentId,
          pd.Amount,
          pd.Status,
          pd.PaymentDate
        FROM FormValues_dtl fv
        JOIN FormRegister_dtl fr ON fv.EmailorPhoneno = fr.Id
        JOIN FormMaster_dtl fm ON fv.FormId = fm.FormId -- Join to filter by user
        LEFT JOIN Register_dtl reg ON fr.Emailormobileno = reg.Email -- Get the username
        LEFT JOIN Payments_dtl pd ON fv.SubmissionId = pd.SubmissionId
        WHERE fm.UserId = @UserId -- Filter by the logged-in user
        GROUP BY fv.SubmissionId, fr.Emailormobileno, reg.Name, pd.RazorpayPaymentId, pd.Amount, pd.Status, pd.PaymentDate
        ORDER BY fv.SubmissionId DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

router.get('/count-by-form', verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('UserId', sql.Int, req.user.UserId)
      .query(`
        SELECT
          fm.FormId,
          fm.FormName,
          COUNT(DISTINCT fv.SubmissionId) as SubmissionCount
        FROM
          FormValues_dtl fv
        JOIN
          FormMaster_dtl fm ON fv.FormId = fm.FormId
        WHERE fm.UserId = @UserId
        GROUP BY
          fm.FormId,
          fm.FormName
        ORDER BY
          fm.FormName
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

module.exports = router;