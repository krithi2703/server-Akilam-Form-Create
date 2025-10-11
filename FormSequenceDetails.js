const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("./dbConfig");
const verifyToken = require('./authMiddleware');

// ---------------- GET: Show all forms with columns (FormName → ColumnName wise) ----------------
router.get("/show", verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input("UserId", sql.Int, req.user.UserId)
      .query(`
        SELECT 
          fm.FormId,
          fm.FormName,
          fm.Enddate,
          dc.Id AS ColId,
          dc.ColumnName,
          dc.DataType,
          fd.SequenceNo,
          fd.FormNo,
          r.Name AS UserName,
          fd.Active,
          fd.BannerImage,
          fd.IsReadOnly
        FROM FormDetails_dtl fd
        INNER JOIN FormMaster_dtl fm ON fd.FormId = fm.FormId
        INNER JOIN DynamicColumns dc ON fd.ColId = dc.Id
        INNER JOIN Register_dtl r ON fd.UserId = r.Id
        WHERE fd.UserId = @UserId AND fd.Active = 1 AND fm.Enddate >= GETDATE()
        ORDER BY fd.FormNo, fm.FormId, fm.FormName, fd.SequenceNo
      `);

    const grouped = result.recordset.reduce((acc, row) => {
      if (!acc[row.FormId]) {
        acc[row.FormId] = {
          FormId: row.FormId,
          FormName: row.FormName,
          columns: []
        };
      }
      acc[row.FormId].columns.push({
        ColId: row.ColId,
        ColumnName: row.ColumnName,
        DataType: row.DataType,
        SequenceNo: row.SequenceNo,
        FormNo: row.FormNo,
        UserName: row.UserName,
        Active: row.Active,
        BannerImage: row.BannerImage
      });
      return acc;
    }, {});

    res.json(Object.values(grouped));
  } catch (err) {
    console.error("Error fetching form & columns:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------- GET: next available FormNo for a FormId ----------------
router.get("/next-formno/:formId", verifyToken, async (req, res) => {
  try {
    const { formId } = req.params;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("FormId", sql.Int, formId)
      .query(`
        SELECT ISNULL(MAX(FormNo), 0) + 1 AS NextFormNo
        FROM FormDetails_dtl
        WHERE FormId = @FormId
      `);

    if (result.recordset.length === 0) {
      return res.json({ nextFormNo: 1 });
    }

    res.json({ nextFormNo: result.recordset[0].NextFormNo });
  } catch (err) {
    console.error("Error fetching next form number:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------- GET: fetch all active forms of logged-in user ----------------
router.get("/user/forms", verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("UserId", sql.Int, req.user.UserId)
      .query(`
        SELECT DISTINCT fm.FormId, fm.FormName
        FROM FormMaster_dtl fm
        WHERE fm.UserId = @UserId AND fm.Active = 1
        ORDER BY fm.FormName
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching forms:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------- GET: fetch columns of a selected form ----------------
// routes/formdetails.js
// ---------------- GET: fetch columns of a selected form ----------------
router.get("/user/form-columns", verifyToken, async (req, res) => {
  //console.log(
   // `[FormColumns] Attempting to fetch columns for userId: ${req.user.UserId}, formId: ${req.query.formId}, formNo: ${req.query.formNo}`
  //);
  //console.log(`[FormColumns] User ID from req.user: ${req.user ? req.user.UserId : 'undefined'}`);
  try {
    const { formId, formNo } = req.query;

    if (!formId) {
      //console.log("[FormColumns] Error: formId is required");
      return res.status(400).json({ message: "formId is required" });
    }

    const parsedFormId = parseInt(formId, 10);
    if (isNaN(parsedFormId)) {
      //console.log(`[FormColumns] Error: Invalid formId: ${formId}`);
      return res.status(400).json({ message: "Invalid formId" });
    }

    const pool = await poolPromise;

    // Build the query based on whether formNo is provided
    let query = `
      SELECT 
        fd.Id,
        fm.FormId,
        fm.FormName,
        fm.Fee,
        fm.ImageOrLogo,
        ISNULL(CONVERT(VARCHAR(10), fm.CreatedDate, 120), '') AS Startdate, -- Select startdate from FormMaster_dtl
        ISNULL(CONVERT(VARCHAR(10), fm.Enddate, 120), '') AS Enddate, -- Select enddate from FormMaster_dtl
        dc.Id AS ColId,
        dc.ColumnName,
        dc.DataType,
        fd.SequenceNo,
        fd.FormNo,
        r.Name AS UserName,
        fd.Active,
        fd.IsValid,
        fd.BannerImage,
        fd.IsReadOnly
      FROM FormDetails_dtl fd
      INNER JOIN FormMaster_dtl fm ON fd.FormId = fm.FormId
      INNER JOIN DynamicColumns dc ON fd.ColId = dc.Id
      INNER JOIN Register_dtl r ON fd.UserId = r.Id
      WHERE fd.FormId = @FormId
        AND fd.Active = 1
    `;

    // Add formNo filter if provided
    if (formNo) {
      const parsedFormNo = parseInt(formNo, 10);
      if (!isNaN(parsedFormNo)) {
        query += ` AND fd.FormNo = @FormNo`;
      }
    }

    query += ` ORDER BY fd.FormNo, fd.SequenceNo`;

   // console.log(`[FormColumns] Executing SQL Query:\n${query}`);

    const request = pool
      .request()
      .input("FormId", sql.Int, parsedFormId);

    // Add formNo parameter if provided
    if (formNo) {
      const parsedFormNo = parseInt(formNo, 10);
      if (!isNaN(parsedFormNo)) {
        request.input("FormNo", sql.Int, parsedFormNo);
      }
    }

    const result = await request.query(query);

    // console.log(
    //   `[FormColumns] Successfully fetched ${result.recordset.length} columns for formId: ${formId}, formNo: ${formNo || 'latest'}`
    // );

    if (result.recordset.length === 0) {
      // console.log("[FormColumns] No records found for the given criteria. Returning empty array.");
      return res.json([]); // Return an empty array with 200 OK status
    }

    res.json(result.recordset);
  } catch (err) {
    console.error("[FormColumns] Error in /api/formdetails/user/form-columns:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------- POST: insert new form detail (with auto-increment FormNo) ----------------
router.post("/insert-formdetails", verifyToken, async (req, res) => {
  const { formId, colId, sequenceNo, active, formNo, bannerimage, isReadOnly } = req.body;
  const pool = await poolPromise;
  const transaction = pool.transaction();

  try {
    await transaction.begin();

    if (!formId || !colId) {
      await transaction.rollback();
      return res.status(400).json({ message: "formId and colId are required" });
    }

    // Ensure formNo is treated as a number if it exists
    const parsedFormNo = formNo ? parseInt(formNo, 10) : null;
    let targetFormNo = parsedFormNo;

    // If formNo is not provided, generate a new one
    if (!targetFormNo || isNaN(targetFormNo)) {
      const maxFormNoResult = await transaction.request()
        .input("FormId", sql.Int, formId)
        .query(`
          SELECT ISNULL(MAX(FormNo), 0) AS MaxFormNo
          FROM FormDetails_dtl
          WHERE FormId = @FormId
        `);
      targetFormNo = (maxFormNoResult.recordset[0].MaxFormNo || 0) + 1;
    }

    // Insert new record
    const result = await transaction.request()
      .input("FormId", sql.Int, formId)
      .input("ColId", sql.Int, colId)
      .input("SequenceNo", sql.Int, sequenceNo || 1)
      .input("FormNo", sql.Int, targetFormNo)
      .input("UserId", sql.Int, req.user.UserId)
      .input("Active", sql.Bit, active !== undefined ? active : 1)
      .input("BannerImage", sql.NVarChar(255), bannerimage)
      .input("IsReadOnly", sql.Bit, isReadOnly !== undefined ? isReadOnly : 0)
      .query(`
        INSERT INTO FormDetails_dtl (FormId, ColId, SequenceNo, FormNo, UserId, Active, BannerImage, IsReadOnly)
        VALUES (@FormId, @ColId, @SequenceNo, @FormNo, @UserId, @Active, @BannerImage, @IsReadOnly);

        SELECT SCOPE_IDENTITY() AS NewId;
      `);

    res.status(201).json({
      message: "Form detail inserted successfully",
      id: result.recordset[0].NewId,
      formNo: targetFormNo
    });
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    console.error("Error inserting form detail:", err);
    res.status(500).json({ message: "Server error" });
  }
});


// ---------------- PUT: update DynamicColumns and FormDetails_dtl ----------------
router.put("/update-columns-formdetails/:id", verifyToken, async (req, res) => {
  const { ColumnName, DataType, SequenceNo, FormId, Active, bannerimage, isReadOnly } = req.body;
  const colId = req.params.id;

  if (!ColumnName || !DataType || !FormId) {
    return res.status(400).json({ message: "ColumnName, DataType, and FormId are required" });
  }

  const pool = await poolPromise;
  const transaction = pool.transaction();
  await transaction.begin();

  try {
    const dupCheck = await transaction.request()
      .input("FormId", sql.Int, FormId)
      .input("ColId", sql.Int, colId)
      .input("ColumnName", sql.NVarChar(100), ColumnName)
      .query(`
        SELECT dc.Id 
        FROM FormDetails_dtl fd
        INNER JOIN DynamicColumns dc ON fd.ColId = dc.Id
        WHERE fd.FormId = @FormId
          AND dc.ColumnName = @ColumnName
          AND dc.Id <> @ColId
          AND fd.Active = 1
      `);

    if (dupCheck.recordset.length > 0) {
      await transaction.rollback();
      return res.status(409).json({ message: "Duplicate column name already exists in this form" });
    }

    await transaction.request()
      .input("Id", sql.Int, colId)
      .input("ColumnName", sql.NVarChar(100), ColumnName)
      .input("DataType", sql.NVarChar(50), DataType)
      .input("IsActive", sql.Bit, Active !== undefined ? Active : 1)
      .query(`
        UPDATE DynamicColumns
        SET ColumnName = @ColumnName,
            DataType = @DataType,
            IsActive = @IsActive
        WHERE Id = @Id
      `);

    const result = await transaction.request()
      .input("FormId", sql.Int, FormId)
      .input("ColId", sql.Int, colId)
      .input("SequenceNo", sql.Int, SequenceNo || 1)
      .input("UserId", sql.Int, req.user.UserId)
      .input("Active", sql.Bit, Active !== undefined ? Active : 1)
      .input("BannerImage", sql.NVarChar(255), bannerimage)
      .input("IsReadOnly", sql.Bit, isReadOnly !== undefined ? isReadOnly : 0)
      .query(`
        UPDATE FormDetails_dtl
        SET SequenceNo = @SequenceNo,
            UserId = @UserId,
            Active = @Active,
            BannerImage = @BannerImage,
            IsReadOnly = @IsReadOnly
        WHERE FormId = @FormId AND ColId = @ColId
      `);

    if (result.rowsAffected[0] === 0) {
      await transaction.rollback();
      return res.status(404).json({ message: "No matching FormDetails record found to update" });
    }

    await transaction.commit();
    res.json({ message: "DynamicColumns and FormDetails_dtl updated successfully" });
  } catch (err) {
    await transaction.rollback();
    console.error("Error updating columns and form details:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------- PUT: update sequence number for a form detail ----------------
router.put("/sequence/:id", verifyToken, async (req, res) => {
  const { sequenceNo } = req.body;
  const { id } = req.params;

  if (!sequenceNo || isNaN(parseInt(sequenceNo, 10))) {
    return res.status(400).json({ message: "A valid sequence number is required." });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input("Id", sql.Int, id)
      .input("SequenceNo", sql.Int, sequenceNo)
      .input("UserId", sql.Int, req.user.UserId)
      .query(`
        UPDATE FormDetails_dtl
        SET SequenceNo = @SequenceNo, UserId = @UserId
        WHERE Id = @Id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: "Form detail record not found." });
    }

    res.json({ message: "Sequence updated successfully." });
  } catch (err) {
    console.error("Error updating sequence:", err);
    res.status(500).json({ message: "Server error while updating sequence." });
  }
});

// ---------------- PUT: update IsValid status for a form detail ----------------
router.put("/update-isvalid/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { isValid } = req.body; // Expecting a boolean

  if (typeof isValid !== 'boolean') {
    return res.status(400).json({ message: "isValid (boolean) is required." });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input("Id", sql.Int, id)
      .input("IsValid", sql.Bit, isValid ? 1 : 0)
      .query(`
        UPDATE FormDetails_dtl
        SET IsValid = @IsValid
        WHERE Id = @Id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: "Form detail not found." });
    }

    res.json({ message: "IsValid status updated successfully." });
  } catch (err) {
    console.error("Error updating IsValid status:", err);
    res.status(500).json({ message: "Server error while updating IsValid status." });
  }
});

// ---------------- PUT: update IsReadOnly status for a form detail ----------------
router.put("/update-isreadonly/:id", verifyToken, async (req, res) => {
  const { id } = req.params; // This is FormDetails_dtl.Id
  const { isReadOnly } = req.body; // Expecting a boolean

  if (typeof isReadOnly !== 'boolean') {
    return res.status(400).json({ message: "isReadOnly (boolean) is required." });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input("Id", sql.Int, id)
      .input("IsReadOnly", sql.Bit, isReadOnly ? 1 : 0)
      .query(`
        UPDATE FormDetails_dtl
        SET IsReadOnly = @IsReadOnly
        WHERE Id = @Id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: "Form detail not found." });
    }

    res.json({ message: "IsReadOnly status updated successfully." });
  } catch (err) {
    console.error("Error updating IsReadOnly status:", err);
    res.status(500).json({ message: "Server error while updating IsReadOnly status." });
  }
});

// ---------------- GET: Check if a column has data in FormValues_dtl ----------------
router.get("/usage/:id", verifyToken, async (req, res) => {
  const { id } = req.params; // This is FormDetails_dtl.Id

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input("Id", sql.Int, id)
      .query(`
        -- Check if any values exist for the given column within its form
        IF EXISTS (
          SELECT 1
          FROM FormValues_dtl fv
          WHERE EXISTS (
            SELECT 1
            FROM FormDetails_dtl fd
            WHERE fd.Id = @Id AND fd.ColId = fv.ColId AND fd.FormId = fv.FormId
          )
        )
          SELECT CAST(1 AS BIT) AS InUse;
        ELSE
          SELECT CAST(0 AS BIT) AS InUse;
      `);

    res.json(result.recordset[0]);
  } catch (err) {
    console.error("Error checking column usage:", err);
    res.status(500).json({ message: "Server error while checking column usage." });
  }
});

// ---------------- GET: single form detail ----------------
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("Id", sql.Int, req.params.id)
      .query(`
        SELECT 
          fd.Id AS FormDetailId,
          fm.FormId,
          fm.FormName,
          dc.Id AS ColId,
          dc.ColumnName,
          dc.DataType,
          fd.SequenceNo,
          fd.FormNo,
          r.Name AS UserName,
          fd.Active,
          fd.BannerImage
        FROM FormDetails_dtl fd
        INNER JOIN FormMaster_dtl fm ON fd.FormId = fm.FormId
        INNER JOIN DynamicColumns dc ON fd.ColId = dc.Id
        INNER JOIN Register_dtl r ON fd.UserId = r.Id
        WHERE fd.Id = @Id AND fd.Active = 1
      `);

    if (!result.recordset.length) return res.status(404).json({ message: "Form detail not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("Error fetching form detail:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------- DELETE: soft delete ----------------
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("Id", sql.Int, req.params.id)
      .query(`
        UPDATE FormDetails_dtl
        SET Active = 0
        WHERE Id = @Id
      `);

    if (result.rowsAffected[0] === 0) 
      return res.status(404).json({ message: "Form detail not found or already deleted" });

    res.json({ message: "Form detail soft deleted successfully" });
  } catch (err) {
    console.error("Error soft deleting form detail:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
