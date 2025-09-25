const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('./dbConfig');

// Endpoint to get form name by ID (publicly accessible)
router.get('/:formId', async (req, res) => {
  const { formId } = req.params;
  if (!formId) {
    return res.status(400).json({ message: 'Form ID is required' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('FormId', sql.Int, formId)
      .query('SELECT FormName FROM FormMaster_dtl WHERE FormId = @FormId');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Form not found' });
    }

    res.json({ FormName: result.recordset[0].FormName });
  } catch (err) {
    console.error('Error fetching form name:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;