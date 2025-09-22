const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('./dbConfig');
const verifyToken = require('./authMiddleware');


// -------------------- POST: Add new checkbox detail --------------------
router.post('/insert', verifyToken, async (req, res) => {
  const { colId, checkBoxName, isActive } = req.body;

  if (!colId || !checkBoxName) {
    return res.status(400).json({ error: 'ColId and CheckBoxName are required' });
  }

  try {
    const pool = await poolPromise;

    // ✅ Verify that colId belongs to the logged-in user
    const colCheck = await pool.request()
      .input('ColId', sql.Int, colId)
      .input('UserId', sql.Int, req.user.UserId) // from JWT payload
      .query(`
        SELECT Id 
        FROM DynamicColumns
        WHERE Id = @ColId 
          AND UserId = @UserId 
          AND IsActive = 1
      `);

    if (colCheck.recordset.length === 0) {
      return res.status(403).json({ error: 'Column not found or not accessible' });
    }

    // ✅ Insert new checkbox
    await pool.request()
      .input('ColId', sql.Int, colId)
      .input('CheckBoxName', sql.NVarChar(255), checkBoxName)
      .input('UserId', sql.Int, req.user.UserId)
      .input('IsActive', sql.Bit, isActive ?? 1)
      .query(`
        INSERT INTO CheckBox_dtl (ColId, CheckBoxName, UserId, IsActive)
        VALUES (@ColId, @CheckBoxName, @UserId, @IsActive)
      `);

    res.status(201).json({ message: 'Checkbox item added successfully' });
  } catch (err) {
    console.error('Error adding checkbox item:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// -------------------- GET: Get all checkbox items for a given ColId --------------------
router.get('/:colId', verifyToken, async (req, res) => {
  const colId = parseInt(req.params.colId, 10);

  if (isNaN(colId)) {
    return res.status(400).json({ error: 'Invalid ColId provided.' });
  }

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('ColId', sql.Int, colId)
      .query(`
        SELECT 
          c.Id AS CheckBoxId,
          c.CheckBoxName,
          c.IsActive,
          r.Name AS CreatedBy,
          r.Email AS CreatedByEmail
        FROM CheckBox_dtl c
        INNER JOIN DynamicColumns dc ON c.ColId = dc.Id
        INNER JOIN Register_dtl r ON c.UserId = r.Id
        WHERE c.ColId = @ColId 
          AND c.IsActive = 1
          AND dc.IsActive = 1
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching checkbox items:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
