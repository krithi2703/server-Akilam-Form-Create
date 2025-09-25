const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('./dbConfig');
const verifyToken = require('./authMiddleware');

// -------------------- POST: Add new checkbox detail --------------------
router.post('/insert', verifyToken, async (req, res) => {
  const { colId, checkBoxName, isActive, formId } = req.body;

  if (!colId || !checkBoxName || !formId) {
    return res.status(400).json({ error: 'ColId, CheckBoxName, and FormId are required' });
  }

  try {
    const pool = await poolPromise;

    // Insert new checkbox
    await pool.request()
      .input('ColId', sql.Int, colId)
      .input('FormId', sql.Int, formId)
      .input('CheckBoxName', sql.NVarChar(255), checkBoxName)
      .input('UserId', sql.Int, req.user.UserId)
      .input('IsActive', sql.Bit, isActive ?? 1)
      .query(`
        INSERT INTO CheckBox_dtl (ColId, FormId, CheckBoxName, UserId, IsActive)
        VALUES (@ColId, @FormId, @CheckBoxName, @UserId, @IsActive)
      `);

    res.status(201).json({ message: 'Checkbox item added successfully' });
  } catch (err) {
    console.error('Error adding checkbox item:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// -------------------- GET: Get all checkbox items for a given ColId and FormId --------------------
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
          c.Id AS CheckBoxId,
          c.CheckBoxName,
          c.IsActive,
          f.FormName,
          r.Name AS CreatedBy,
          r.Email AS CreatedByEmail,
          dc.ColumnName
        FROM CheckBox_dtl c
        INNER JOIN DynamicColumns dc ON c.ColId = dc.Id
        INNER JOIN FormMaster_dtl f ON c.FormId = f.FormId
        INNER JOIN Register_dtl r ON c.UserId = r.Id
        WHERE c.ColId = @ColId
          AND c.FormId = @FormId
          AND c.IsActive = 1
          AND dc.IsActive = 1
          AND f.Active = 1
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching checkbox items:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// -------------------- PUT: Update checkbox detail --------------------
router.put('/update/:id', verifyToken, async (req, res) => {
  const checkBoxId = parseInt(req.params.id, 10);
  const { checkBoxName } = req.body;

  if (isNaN(checkBoxId)) {
    return res.status(400).json({ error: 'Invalid CheckBoxId provided.' });
  }

  if (!checkBoxName) {
    return res.status(400).json({ error: 'CheckBoxName is required.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('CheckBoxId', sql.Int, checkBoxId)
      .input('CheckBoxName', sql.NVarChar(255), checkBoxName)
      .query(`
        UPDATE CheckBox_dtl
        SET CheckBoxName = @CheckBoxName
        WHERE Id = @CheckBoxId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Checkbox item not found.' });
    }

    res.status(200).json({ message: 'CheckBox name updated successfully.' });
  } catch (err) {
    console.error('Error updating checkbox name:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// -------------------- DELETE: Soft delete checkbox detail --------------------
router.delete('/delete/:id', verifyToken, async (req, res) => {
  const checkBoxId = parseInt(req.params.id, 10);

  if (isNaN(checkBoxId)) {
    return res.status(400).json({ error: 'Invalid CheckBoxId provided.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('CheckBoxId', sql.Int, checkBoxId)
      .query(`
        UPDATE CheckBox_dtl
        SET IsActive = 0
        WHERE Id = @CheckBoxId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Checkbox item not found.' });
    }

    res.status(200).json({ message: 'Checkbox item soft-deleted successfully.' });
  } catch (err) {
    console.error('Error soft-deleting checkbox item:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;