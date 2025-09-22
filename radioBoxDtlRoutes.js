const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('./dbConfig');
const verifyToken = require('./authMiddleware');


// -------------------- POST: Add new radio box detail --------------------
router.post('/insert', verifyToken, async (req, res) => {
  const { colId, radioBoxName, isActive } = req.body;

  if (!colId || !radioBoxName) {
    return res.status(400).json({ error: 'ColId and RadioBoxName are required' });
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

    // ✅ Insert into RadioBox_dtl
    await pool.request()
      .input('ColId', sql.Int, colId)
      .input('RadioBoxName', sql.NVarChar(255), radioBoxName)
      .input('UserId', sql.Int, req.user.UserId)
      .input('IsActive', sql.Bit, isActive ?? 1) // default = active
      .query(`
        INSERT INTO RadioBox_dtl (ColId, RadioBoxName, UserId, IsActive)
        VALUES (@ColId, @RadioBoxName, @UserId, @IsActive)
      `);

    res.status(201).json({ message: 'Radio box item added successfully' });
  } catch (err) {
    console.error('Error adding radio box item:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// -------------------- GET: Get all radio box items for a given ColId --------------------
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
          r.Id AS RadioBoxId,
          r.RadioBoxName,
          r.IsActive,
          u.Name AS CreatedBy,
          u.Email AS CreatedByEmail
        FROM RadioBox_dtl r
        INNER JOIN DynamicColumns dc ON r.ColId = dc.Id
        INNER JOIN Register_dtl u ON r.UserId = u.Id
        WHERE r.ColId = @ColId
          AND r.IsActive = 1
          AND dc.IsActive = 1
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching radio box items:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


module.exports = router;
