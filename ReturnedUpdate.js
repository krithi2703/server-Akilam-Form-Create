const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("./dbConfig");
const verifyToken = require('./authMiddleware');

// ---------------- Middleware ----------------
function ensureAuthenticated(req, res, next) {
  const userId = req.headers["userid"] || req.query.userId;
  if (!userId) return res.status(401).json({ error: "User not logged in" });
  req.userId = parseInt(userId);
  next();
}

// ---------------- GET: Show all forms with columns (FormName → ColumnName wise) ----------------
router.get("/show", ensureAuthenticated, async (req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input("UserId", sql.Int, req.userId)
      .query(`
        SELECT 
          fm.FormId,
          fm.FormName,
          dc.Id AS ColId,
          dc.ColumnName,
          dc.DataType,
          fd.SequenceNo,
          r.Name AS UserName,
          fd.Active
        FROM FormDetails_dtl fd
        INNER JOIN FormMaster_dtl fm ON fd.FormId = fm.FormId
        INNER JOIN DynamicColumns dc ON fd.ColId = dc.Id
        INNER JOIN Register_dtl r ON fd.UserId = r.Id
        WHERE fd.UserId = @UserId AND fd.Active = 1
        ORDER BY fm.FormName, fd.SequenceNo
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
        UserName: row.UserName,
        Active: row.Active
      });
      return acc;
    }, {});

    res.json(Object.values(grouped));
  } catch (err) {
    console.error("Error fetching form & columns:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------- GET: fetch all active forms of logged-in user ----------------
router.get("/user/forms", ensureAuthenticated, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("UserId", sql.Int, req.userId)
      .query(`
        SELECT DISTINCT fm.FormId, fm.FormName
        FROM FormMaster_dtl fm
        INNER JOIN FormDetails_dtl fd ON fm.FormId = fd.FormId
        WHERE fd.UserId = @UserId AND fd.Active = 1
        ORDER BY fm.FormName
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching forms:", err);
    res.status(500).json({ message: "Server error" });
  }
});


// ---------------- POST: Insert Dynamic Column ----------------
router.post("/insert-column", ensureAuthenticated, async (req, res) => {
  try {
    const { ColumnName, DataType, FormNo, IsActive } = req.body;

    if (!ColumnName || !DataType || !FormNo) {
      return res.status(400).json({
        message: "ColumnName, DataType, and FormNo are required",
      });
    }

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("ColumnName", sql.NVarChar, ColumnName)
      .input("DataType", sql.NVarChar, DataType)
      .input("UserId", sql.Int, req.userId) // ✅ From middleware
      .input("FormNo", sql.Int, FormNo)     // ✅ From frontend
      .input("IsActive", sql.Bit, IsActive ?? true)
      .query(`
        INSERT INTO DynamicColumns (ColumnName, DataType, UserId, FormNo, IsActive)
        VALUES (@ColumnName, @DataType, @UserId, @FormNo, @IsActive)
      `);

    res.status(201).json({ message: "✅ Column inserted successfully!" });
  } catch (err) {
    console.error("🔥 Insert Column Error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// ---------------- GET: Fetch Columns by FormNo ----------------
router.get("/get-columns/:formNo", ensureAuthenticated, async (req, res) => {
  try {
    const { formNo } = req.params;
    const pool = await poolPromise;

    const result = await pool
      .request()
      .input("FormNo", sql.Int, formNo)
      .input("UserId", sql.Int, req.userId)
      .query(`
        SELECT Id, ColumnName, DataType, UserId, FormNo, IsActive
        FROM DynamicColumns
        WHERE FormNo = @FormNo AND UserId = @UserId
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error("🔥 Fetch Columns Error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});
// ---------------- POST: insert new form detail (prevent duplicates) ----------------
router.post("/insert-Formdetailed", ensureAuthenticated, async (req, res) => {
  try {
    const { formId, colId, sequenceNo, active } = req.body;
    if (!formId || !colId) return res.status(400).json({ message: "formId and colId are required" });

    const pool = await poolPromise;

    const dupCheck = await pool.request()
      .input("FormId", sql.Int, formId)
      .input("ColId", sql.Int, colId)
      .query(`
        SELECT Id FROM FormDetails_dtl
        WHERE FormId = @FormId AND ColId = @ColId AND Active = 1
      `);

    if (dupCheck.recordset.length > 0) {
      return res.status(409).json({ message: "This column already exists in the form" });
    }

    const result = await pool
      .request()
      .input("FormId", sql.Int, formId)
      .input("ColId", sql.Int, colId)
      .input("SequenceNo", sql.Int, sequenceNo)
      .input("UserId", sql.Int, req.userId)
      .input("Active", sql.Bit, active !== undefined ? active : 1)
      .query(`
        INSERT INTO FormDetails_dtl (FormId, ColId, SequenceNo, UserId, Active)
        VALUES (@FormId, @ColId, @SequenceNo, @UserId, @Active);
        SELECT SCOPE_IDENTITY() AS NewDetailId;
      `);

    res.json({ message: "Form detail inserted", newDetailId: result.recordset[0].NewDetailId });
  } catch (err) {
    console.error("Error inserting form detail:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------- POST: insert new column and form detail ----------------
router.post("/insert-columns-formdetails", ensureAuthenticated, async (req, res) => {
  const { ColumnName, DataType, SequenceNo, FormId, Active } = req.body;
  
  if (!ColumnName || !DataType || !FormId) {
    return res.status(400).json({ message: "ColumnName, DataType, and FormId are required" });
  }

  const pool = await poolPromise;
  const transaction = pool.transaction();
  await transaction.begin();

  try {
    // 🔹 Generate a FormNo (string version of FormId, or you can customize logic here)
    const finalFormNo = FormId.toString();

    // ✅ Check for duplicate column name in the same form
    const dupCheck = await transaction.request()
      .input("FormId", sql.Int, FormId)
      .input("ColumnName", sql.NVarChar(100), ColumnName)
      .query(`
        SELECT dc.Id 
        FROM FormDetails_dtl fd
        INNER JOIN DynamicColumns dc ON fd.ColId = dc.Id
        WHERE fd.FormId = @FormId
          AND dc.ColumnName = @ColumnName
          AND fd.Active = 1
      `);

    if (dupCheck.recordset.length > 0) {
      await transaction.rollback();
      return res.status(409).json({ message: "Duplicate column name already exists in this form" });
    }

    // ✅ Insert into DynamicColumns (with UserId + FormNo)
    const colResult = await transaction.request()
      .input("ColumnName", sql.NVarChar(100), ColumnName)
      .input("DataType", sql.NVarChar(50), DataType)
      .input("UserId", sql.Int, req.userId)
      .input("FormNo", sql.NVarChar(10), finalFormNo)
      .input("IsActive", sql.Bit, Active !== undefined ? Active : 1)
      .query(`
        INSERT INTO DynamicColumns (ColumnName, DataType, UserId, FormNo, IsActive)
        VALUES (@ColumnName, @DataType, @UserId, @FormNo, @IsActive);
        SELECT SCOPE_IDENTITY() AS NewColId;
      `);

    const newColId = colResult.recordset[0].NewColId;

    // ✅ Insert into FormDetails_dtl
    await transaction.request()
      .input("FormId", sql.Int, FormId)
      .input("ColId", sql.Int, newColId)
      .input("SequenceNo", sql.Int, SequenceNo || 1)
      .input("UserId", sql.Int, req.userId)
      .input("Active", sql.Bit, Active !== undefined ? Active : 1)
      .query(`
        INSERT INTO FormDetails_dtl (FormId, ColId, SequenceNo, UserId, Active)
        VALUES (@FormId, @ColId, @SequenceNo, @UserId, @Active)
      `);

    await transaction.commit();
    res.json({ 
      message: "✅ Column and form detail inserted successfully", 
      newColId: newColId 
    });
  } catch (err) {
    await transaction.rollback();
    console.error("🔥 Error inserting column and form detail:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// ---------------- PUT: update DynamicColumns and FormDetails_dtl ----------------
router.put("/update-columns-formdetails/:id", ensureAuthenticated, async (req, res) => {
  const { ColumnName, DataType, SequenceNo, FormId, Active } = req.body;
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
      .input("UserId", sql.Int, req.userId)
      .input("Active", sql.Bit, Active !== undefined ? Active : 1)
      .query(`
        UPDATE FormDetails_dtl
        SET SequenceNo = @SequenceNo,
            UserId = @UserId,
            Active = @Active
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

// ---------------- GET: single form detail ----------------
router.get("/:id", ensureAuthenticated, async (req, res) => {
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
          r.Name AS UserName,
          fd.Active
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
router.delete("/:id", ensureAuthenticated, async (req, res) => {
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