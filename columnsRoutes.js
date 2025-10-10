const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('./dbConfig');
const verifyToken = require('./authMiddleware');

// ---------------- GET: all active columns for logged-in user ----------------
router.get('/', verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('UserId', sql.Int, req.user.UserId)
      .query(`
        SELECT 
          c.Id AS ColumnId, 
          c.ColumnName, 
          c.DataType, 
          c.IsActive,
          u.Name AS UserName
        FROM DynamicColumns c
        INNER JOIN Register_dtl u ON c.UserId = u.Id
        WHERE c.UserId=@UserId AND c.IsActive=1
        ORDER BY c.Id
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching columns:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---------------- POST: add new columns ----------------
router.post('/', verifyToken, async (req, res) => {
  const { columns } = req.body;

  if (!Array.isArray(columns) || columns.length === 0) {
    return res.status(400).json({ error: 'At least one column is required' });
  }

  try {
    const pool = await poolPromise;
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      for (const col of columns) {
        if (!col.ColumnName || !col.DataType) {
          await transaction.rollback();
          return res.status(400).json({ error: 'ColumnName and DataType required' });
        }

        await transaction.request()
          .input('ColumnName', sql.NVarChar(sql.MAX), col.ColumnName)
          .input('DataType', sql.NVarChar(50), col.DataType)
          .input('UserId', sql.Int, req.user.UserId)
          .input('IsActive', sql.Bit, 1)
          .query(`
            INSERT INTO DynamicColumns (ColumnName, DataType, UserId, IsActive)
            VALUES (@ColumnName, @DataType, @UserId, @IsActive)
          `);
      }

      await transaction.commit();
      res.json({ message: 'Columns added successfully' });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error('Error adding columns:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---------------- PUT: update column ----------------
router.put('/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { ColumnName, DataType, IsActive } = req.body;

  if (!ColumnName || !DataType) {
    return res.status(400).json({ error: 'ColumnName and DataType required' });
  }

  try {
    const pool = await poolPromise;
    await pool.request()
      .input('Id', sql.Int, id)
      .input('ColumnName', sql.NVarChar(sql.MAX), ColumnName)
      .input('DataType', sql.NVarChar(50), DataType)
      .input('IsActive', sql.Bit, IsActive !== undefined ? IsActive : 1)
      .input('UserId', sql.Int, req.user.UserId)
      .query(`
        UPDATE DynamicColumns
        SET ColumnName=@ColumnName, DataType=@DataType, IsActive=@IsActive
        WHERE Id=@Id AND UserId=@UserId
      `);

    res.json({ message: 'Column updated successfully' });
  } catch (err) {
    console.error('Error updating column:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---------------- DELETE: soft delete column ----------------
router.delete('/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('Id', sql.Int, id)
      .input('UserId', sql.Int, req.user.UserId)
      .query(`
        UPDATE DynamicColumns
        SET IsActive=0
        WHERE Id=@Id AND UserId=@UserId
      `);

    res.json({ message: 'Column soft deleted successfully' });
  } catch (err) {
    console.error('Error deleting column:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---------------- GET: dashboard counts ----------------
router.get('/counts', verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('UserId', sql.Int, req.user.UserId)
      .query(`
        SELECT 
          (SELECT COUNT(*) FROM FormMaster_dtl WHERE UserId = @UserId AND Active = 1) AS formCount,
          (SELECT COUNT(*) FROM DynamicColumns WHERE UserId = @UserId AND IsActive = 1) AS columnCount,
          (SELECT COUNT(DISTINCT fv.SubmissionId) FROM FormValues_dtl fv INNER JOIN FormMaster_dtl fm ON fv.FormId = fm.FormId WHERE fm.UserId = @UserId) AS submissionCount,
          (SELECT COUNT(DISTINCT fr.Id) FROM FormRegister_dtl fr INNER JOIN FormValues_dtl fv ON fr.Id = fv.EmailorPhoneno INNER JOIN FormMaster_dtl fm ON fv.FormId = fm.FormId WHERE fm.UserId = @UserId) AS userCount
      `);

    res.json(result.recordset[0]);
  } catch (err) {
    console.error('Error fetching counts:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// ---------------- GET: default columns ----------------
router.get('/default', verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .query(`
        SELECT 
          Id AS ColumnId, 
          ColumnName, 
          Type
        FROM defaultColumns_dtl
        ORDER BY Id
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching default columns:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
