const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('./dbConfig');
const verifyToken = require('./authMiddleware');

// -------------------- GET: Get all validation types --------------------
router.get('/types', verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT Id, ValidationList
      FROM DropdownValidation_detail
        ORDER BY Id
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching validation types:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// -------------------- POST: Add new validation detail --------------------
router.post('/insert', verifyToken, async (req, res) => {
  const { Validationid, ColId, FormId, Active } = req.body;

  if (!Validationid || !ColId || !FormId) {
    return res.status(400).json({ error: 'Validationid, ColId, and FormId are required.' });
  }

  try {
    const pool = await poolPromise;

    await pool.request()
      .input('Validationid', sql.Int, Validationid)
      .input('ColId', sql.Int, ColId)
      .input('FormId', sql.Int, FormId)
      .input('Active', sql.Bit, Active ?? 1)
      .query(`
        INSERT INTO Validation_dtl (Validationid, ColId, FormId, Active)
        VALUES (@Validationid, @ColId, @FormId, @Active)
      `);

    res.status(201).json({ message: 'Validation detail added successfully' });
  } catch (err) {
    console.error('Error adding validation detail:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// -------------------- GET: Get all validation details for a given FormId --------------------
router.get('/:Id', verifyToken, async (req, res) => {
  const formId = parseInt(req.params.Id, 10);

  if (isNaN(formId)) {
    return res.status(400).json({ error: 'Invalid FormId provided.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('FormId', sql.Int, formId)
      .query(`
        SELECT
          vd.Id AS ValidationDtlId,
          vd.Validationid,
          vd.ColId,
          vd.FormId,
          vd.Active,
          dvd.ValidationList,
          dc.ColumnName,
          dc.DataType,
          fm.FormName
        FROM Validation_dtl vd
        INNER JOIN DropdownValidation_detail dvd ON vd.Validationid = dvd.Id
        INNER JOIN DynamicColumns dc ON vd.ColId = dc.Id
        INNER JOIN FormMaster_dtl fm ON vd.FormId = fm.FormId
        WHERE vd.FormId = @FormId
          AND vd.Active = 1
          AND dc.IsActive = 1
          AND fm.Active = 1
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching validation details:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// -------------------- PUT: Update validation detail --------------------
router.put('/update/:id', verifyToken, async (req, res) => {
  const validationDtlId = parseInt(req.params.id, 10);
  const { Validationid, Active } = req.body;

  if (isNaN(validationDtlId)) {
    return res.status(400).json({ error: 'Invalid ValidationDtlId provided.' });
  }

  if (!Validationid) {
    return res.status(400).json({ error: 'Validationid is required.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('ValidationDtlId', sql.Int, validationDtlId)
      .input('Validationid', sql.Int, Validationid)
      .input('Active', sql.Bit, Active ?? 1)
      .query(`
        UPDATE Validation_dtl
        SET Validationid = @Validationid,
            Active = @Active
        WHERE Id = @ValidationDtlId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Validation detail not found.' });
    }

    res.status(200).json({ message: 'Validation detail updated successfully.' });
  } catch (err) {
    console.error('Error updating validation detail:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// -------------------- DELETE: Soft delete validation detail --------------------
router.delete('/delete/:id', verifyToken, async (req, res) => {
  const validationDtlId = parseInt(req.params.id, 10);

  if (isNaN(validationDtlId)) {
    return res.status(400).json({ error: 'Invalid ValidationDtlId provided.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('ValidationDtlId', sql.Int, validationDtlId)
      .query(`
        UPDATE Validation_dtl
        SET Active = 0
        WHERE Id = @ValidationDtlId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Validation detail not found.' });
    }

    res.status(200).json({ message: 'Validation detail soft-deleted successfully.' });
  } catch (err) {
    console.error('Error soft-deleting validation detail:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
