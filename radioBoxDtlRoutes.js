const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('./dbConfig');
const verifyToken = require('./authMiddleware');

// -------------------- POST: Add new radio box detail --------------------
router.post('/insert', verifyToken, async (req, res) => {
  const { formId, colId, radioBoxName, isActive } = req.body;

  if (!formId || !colId || !radioBoxName) {
    return res.status(400).json({ error: 'FormId, ColId, and RadioBoxName are required' });
  }

  try {
    const pool = await poolPromise;

    // Insert into RadioBox_dtl
    await pool.request()
      .input('FormId', sql.Int, formId)
      .input('ColId', sql.Int, colId)
      .input('RadioBoxName', sql.NVarChar(255), radioBoxName)
      .input('UserId', sql.Int, req.user.UserId)
      .input('IsActive', sql.Bit, isActive ?? 1)
      .query(`
        INSERT INTO RadioBox_dtl (FormId, ColId, RadioBoxName, UserId, IsActive)
        VALUES (@FormId, @ColId, @RadioBoxName, @UserId, @IsActive)
      `);

    res.status(201).json({ message: 'Radio box item added successfully' });
  } catch (err) {
    console.error('Error adding radio box item:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// -------------------- GET: Get all radio box items for a given ColId and FormId --------------------
router.get('/:colId', verifyToken, async (req, res) => {
  const colId = parseInt(req.params.colId, 10);
  const formId = parseInt(req.query.formId, 10);

  if (isNaN(colId) || isNaN(formId)) {
    return res.status(400).json({ error: 'Invalid ColId or FormId provided.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('ColId', sql.Int, colId)
      .input('FormId', sql.Int, formId)
      .query(`
        SELECT 
          r.Id AS RadioBoxId,
          r.ColId,
          r.RadioBoxName,
          r.IsActive,
          u.Name AS CreatedBy,
          u.Email AS CreatedByEmail,
          dc.ColumnName
        FROM RadioBox_dtl r
        INNER JOIN FormMaster_dtl f ON r.FormId = f.FormId
        INNER JOIN Register_dtl u ON r.UserId = u.Id
        INNER JOIN DynamicColumns dc ON r.ColId = dc.Id
        WHERE r.ColId = @ColId
          AND r.FormId = @FormId
          AND r.IsActive = 1
          AND f.Active = 1
          AND dc.IsActive = 1
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching radio box items:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// -------------------- PUT: Update radio box detail --------------------
router.put('/update/:id', verifyToken, async (req, res) => {
  const radioBoxId = parseInt(req.params.id, 10);
  const { radioBoxName } = req.body;

  if (isNaN(radioBoxId)) {
    return res.status(400).json({ error: 'Invalid RadioBoxId provided.' });
  }

  if (!radioBoxName) {
    return res.status(400).json({ error: 'RadioBoxName is required.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('RadioBoxId', sql.Int, radioBoxId)
      .input('RadioBoxName', sql.NVarChar(255), radioBoxName)
      .query(`
        UPDATE RadioBox_dtl
        SET RadioBoxName = @RadioBoxName
        WHERE Id = @RadioBoxId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Radio box item not found.' });
    }

    res.status(200).json({ message: 'RadioBox name updated successfully.' });
  } catch (err) {
    console.error('Error updating radio box name:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// -------------------- DELETE: Soft delete radio box detail --------------------
router.delete('/delete/:id', verifyToken, async (req, res) => {
  const radioBoxId = parseInt(req.params.id, 10);

  if (isNaN(radioBoxId)) {
    return res.status(400).json({ error: 'Invalid RadioBoxId provided.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('RadioBoxId', sql.Int, radioBoxId)
      .query(`
        UPDATE RadioBox_dtl
        SET IsActive = 0
        WHERE Id = @RadioBoxId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Radio box item not found.' });
    }

    res.status(200).json({ message: 'Radio box item soft-deleted successfully.' });
  } catch (err) {
    console.error('Error soft-deleting radio box item:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;