const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('./dbConfig');
const verifyToken = require('./authMiddleware');

// Endpoint to get all form names for the logged-in user
router.get('/', verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('UserId', sql.Int, req.user.UserId)
      .query('SELECT FormId as formId, FormName as formName FROM FormMaster_dtl WHERE Active = 1 AND UserId = @UserId');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching all form names:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Endpoint to get form name by ID (publicly accessible)
router.get('/:formId', async (req, res) => {
  const { formId } = req.params;
  if (!formId) {
    return res.status(400).json({ message: 'Form ID is required' });
  }

  // Validate formId as an integer
  if (isNaN(parseInt(formId))) {
    return res.status(400).json({ message: 'Invalid Form ID format. Must be an integer.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('FormId', sql.Int, formId)
      .query(`
        SELECT
            fm.FormName,
            (SELECT TOP 1 fd.BannerImage FROM FormDetails_dtl fd WHERE fd.FormId = fm.FormId AND fd.BannerImage IS NOT NULL ORDER BY fd.Id DESC) as BannerImage
        FROM
            FormMaster_dtl fm
        WHERE fm.FormId = @FormId and fm.Active = 1
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Form not found' });
    }

    res.json({
      FormName: result.recordset[0].FormName,
      bannerImage: result.recordset[0].BannerImage
    });
  } catch (err) {
    console.error('Error fetching form name:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;