const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('./dbConfig');
const verifyToken = require('./authMiddleware');

// -------------------- POST: Add new dropdown detail --------------------
router.post('/insert', verifyToken, async (req, res) => {
  const { colId, dropdownName, isActive, formId } = req.body;

  if (!colId || !dropdownName || !formId) {
    return res.status(400).json({ error: 'ColId, DropdownName, and FormId are required' });
  }

  try {
    const pool = await poolPromise;

    // Insert new dropdown item
    await pool.request()
      .input('ColId', sql.Int, colId)
      .input('FormId', sql.Int, formId)
      .input('DropdownName', sql.NVarChar(255), dropdownName)
      .input('UserId', sql.Int, req.user.UserId)
      .input('IsActive', sql.Bit, isActive ?? 1)
      .query(`
        INSERT INTO Dropdown_dtl (ColId, FormId, DropdownName, UserId, IsActive)
        VALUES (@ColId, @FormId, @DropdownName, @UserId, @IsActive)
      `);

    res.status(201).json({ message: 'Dropdown item added successfully' });
  } catch (err) {
    console.error('Error adding dropdown item:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// -------------------- GET: Get all dropdown items for a given ColId and FormId --------------------
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
          d.Id AS DropdownId,
          d.DropdownName,
          d.IsActive,
          fd.FormName,
          r.Name AS CreatedBy,
          r.Email AS CreatedByEmail,
          dc.ColumnName
        FROM Dropdown_dtl d
        INNER JOIN DynamicColumns dc ON d.ColId = dc.Id
        INNER JOIN FormMaster_dtl fd ON d.FormId = fd.FormId
        INNER JOIN Register_dtl r ON d.UserId = r.Id
        WHERE d.ColId = @ColId
          AND d.FormId = @FormId
          AND d.IsActive = 1
          AND dc.IsActive = 1
          AND fd.Active = 1
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching dropdown items:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// -------------------- PUT: Update dropdown detail --------------------
router.put('/update/:id', verifyToken, async (req, res) => {
  const dropdownId = parseInt(req.params.id, 10);
  const { dropdownName } = req.body;

  if (isNaN(dropdownId)) {
    return res.status(400).json({ error: 'Invalid DropdownId provided.' });
  }

  if (!dropdownName) {
    return res.status(400).json({ error: 'DropdownName is required.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('DropdownId', sql.Int, dropdownId)
      .input('DropdownName', sql.NVarChar(255), dropdownName)
      .query(`
        UPDATE Dropdown_dtl
        SET DropdownName = @DropdownName
        WHERE Id = @DropdownId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Dropdown item not found.' });
    }

    res.status(200).json({ message: 'Dropdown name updated successfully.' });
  } catch (err) {
    console.error('Error updating dropdown name:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// -------------------- DELETE: Soft delete dropdown detail --------------------
router.delete('/delete/:id', verifyToken, async (req, res) => {
  const dropdownId = parseInt(req.params.id, 10);

  if (isNaN(dropdownId)) {
    return res.status(400).json({ error: 'Invalid DropdownId provided.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('DropdownId', sql.Int, dropdownId)
      .query(`
        UPDATE Dropdown_dtl
        SET IsActive = 0
        WHERE Id = @DropdownId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Dropdown item not found.' });
    }

    res.status(200).json({ message: 'Dropdown item soft-deleted successfully.' });
  } catch (err) {
    console.error('Error soft-deleting dropdown item:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;