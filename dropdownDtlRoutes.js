const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('./dbConfig');
const verifyToken = require('./authMiddleware');


// -------------------- POST: Add new dropdown detail --------------------
router.post('/insert', verifyToken, async (req, res) => {
  const { colId, dropdownName, isActive } = req.body;

  if (!colId || !dropdownName) {
    return res.status(400).json({ error: 'ColId and DropdownName are required' });
  }

  try {
    const pool = await poolPromise;

    // ✅ Verify colId belongs to the logged-in user
    const colCheck = await pool.request()
      .input('ColId', sql.Int, colId)
      .input('UserId', sql.Int, req.user.UserId) // from JWT
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

    // ✅ Insert new dropdown item
    await pool.request()
      .input('ColId', sql.Int, colId)
      .input('DropdownName', sql.NVarChar(255), dropdownName)
      .input('UserId', sql.Int, req.user.UserId)
      .input('IsActive', sql.Bit, isActive ?? 1) // default active
      .query(`
        INSERT INTO Dropdown_dtl (ColId, DropdownName, UserId, IsActive)
        VALUES (@ColId, @DropdownName, @UserId, @IsActive)
      `);

    res.status(201).json({ message: 'Dropdown item added successfully' });
  } catch (err) {
    console.error('Error adding dropdown item:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// -------------------- GET: Get all dropdown items for a given ColId --------------------
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
          d.Id AS DropdownId,
          d.DropdownName,
          d.IsActive,
          r.Name AS CreatedBy,
          r.Email AS CreatedByEmail
        FROM Dropdown_dtl d
        INNER JOIN DynamicColumns dc ON d.ColId = dc.Id
        INNER JOIN Register_dtl r ON d.UserId = r.Id
        WHERE d.ColId = @ColId 
          AND d.IsActive = 1
          AND dc.IsActive = 1
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching dropdown items:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


module.exports = router;
