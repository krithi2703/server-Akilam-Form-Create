const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('./dbConfig');

router.get('/all', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT
        fv.SubmissionId,
        fr.Emailormobileno,
        pd.RazorpayPaymentId,
        pd.Amount,
        pd.Status,
        pd.PaymentDate
      FROM FormValues_dtl fv
      JOIN FormRegister_dtl fr ON fv.EmailorPhoneno = fr.Id
      LEFT JOIN Payments_dtl pd ON fv.SubmissionId = pd.SubmissionId
      GROUP BY fv.SubmissionId, fr.Emailormobileno, pd.RazorpayPaymentId, pd.Amount, pd.Status, pd.PaymentDate
      ORDER BY fv.SubmissionId DESC
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
