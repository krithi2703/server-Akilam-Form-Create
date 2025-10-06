const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("./dbConfig");
const verifyToken = require("./authMiddleware");
const multer = require("multer");
const path = require("path");

// --- Local File Storage using Multer ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname)); // Append extension
  }
});

const upload = multer({ storage: storage });


// ---------------- Get logged-in user info ----------------
router.get("/me", verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("UserId", sql.Int, req.user.UserId)
      .query(`
        SELECT Id AS UserId, Name AS UserName, Email
        FROM Register_dtl
        WHERE Id = @UserId AND IsActive = 1
      `);

    if (!result.recordset.length)
      return res.status(404).json({ error: "User not found or inactive" });

    res.json(result.recordset[0]);
  } catch (err) {
    console.error("Fetch User Error:", err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// ---------------- Upload Image ----------------
router.post("/upload/image", verifyToken, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    // Return the path to the uploaded file
    const filePath = `/uploads/${req.file.filename}`;
    res.status(200).json({ filePath: filePath });
  } catch (err) {
    console.error("File Upload Error:", err);
    res.status(500).json({ error: "Failed to upload file." });
  }
});

// ---------------- Insert new form ----------------
router.post("/", verifyToken, async (req, res) => {
  try {
    const { formName, createdDate, enddate, fee, imageorlogo } = req.body;

    if (!formName) {
      return res.status(400).json({ error: "Form Name is required" });
    }

    if (!req.user?.UserId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const pool = await poolPromise;

    const result = await pool
      .request()
      .input("FormName", sql.NVarChar(100), formName)
      .input("UserId", sql.Int, req.user.UserId) // ✅ Always available
      .input("CreatedDate", sql.DateTime, createdDate ? new Date(createdDate) : new Date())
      .input("Enddate", sql.DateTime, enddate ? new Date(enddate) : null)
      .input("Fee", sql.Decimal(10, 2), fee ? parseFloat(fee) : null)
      .input("Active", sql.Bit, 1)
      .input("ImageOrLogo", sql.NVarChar(255), imageorlogo || null)
      .query(`
        INSERT INTO FormMaster_dtl (FormName, UserId, CreatedDate, Enddate, Fee, Active, ImageOrLogo)
        VALUES (@FormName, @UserId, @CreatedDate, @Enddate, @Fee, @Active, @ImageOrLogo);
        SELECT SCOPE_IDENTITY() AS NewFormId;
      `);

    const newFormId = result.recordset[0].NewFormId;

    res.status(201).json({
      message: "Form inserted successfully",
      newFormId,
    });
  } catch (err) {
    console.error("Insert Error:", err);
    res.status(500).json({ error: "Failed to insert form" });
  }
});

// ---------------- Get single form by ID ----------------
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("FormId", sql.Int, req.params.id)
      .input("UserId", sql.Int, req.user.UserId)
      .query(`
        SELECT 
          FormId,
          FormName,
          FORMAT(CreatedDate,'dd-MMM-yyyy') AS CreatedDate,
          FORMAT(Enddate,'dd-MMM-yyyy') AS Enddate,
          Fee,
          Active,
          ImageOrLogo
        FROM FormMaster_dtl 
        WHERE FormId = @FormId AND UserId = @UserId
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ error: "Form not found" });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    console.error("Fetch Form Error:", err);
    res.status(500).json({ error: "Failed to fetch form" });
  }
});

// ---------------- Update form ----------------
router.put("/:id", verifyToken, async (req, res) => {
  try {
    const { formName, createdDate, enddate, fee, imageorlogo } = req.body;

    if (!formName) {
      return res.status(400).json({ error: "Form Name is required" });
    }

    const pool = await poolPromise;

    // Check if form exists and belongs to user
    const checkResult = await pool
      .request()
      .input("FormId", sql.Int, req.params.id)
      .input("UserId", sql.Int, req.user.UserId)
      .query("SELECT FormId FROM FormMaster_dtl WHERE FormId = @FormId AND UserId = @UserId");

    if (!checkResult.recordset.length) {
      return res.status(404).json({ error: "Form not found" });
    }

    await pool
      .request()
      .input("FormId", sql.Int, req.params.id)
      .input("FormName", sql.NVarChar(100), formName)
      .input("CreatedDate", sql.DateTime, createdDate ? new Date(createdDate) : new Date())
      .input("Enddate", sql.DateTime, enddate ? new Date(enddate) : null)
      .input("Fee", sql.Decimal(10, 2), fee ? parseFloat(fee) : null)
      .input("ImageOrLogo", sql.NVarChar(255), imageorlogo || null)
      .query(`
        UPDATE FormMaster_dtl
        SET FormName = @FormName,
            CreatedDate = @CreatedDate,
            Enddate = @Enddate,
            Fee = @Fee,
            ImageOrLogo = @ImageOrLogo
        WHERE FormId = @FormId
      `);

    res.json({ message: "Form updated successfully" });
  } catch (err) {
    console.error("Update Error:", err);
    res.status(500).json({ error: "Failed to update form" });
  }
});

// ---------------- Soft delete ----------------
router.put("/soft-delete/:id", verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;

    // Check if form exists and belongs to user
    const checkResult = await pool
      .request()
      .input("FormId", sql.Int, req.params.id)
      .input("UserId", sql.Int, req.user.UserId)
      .query("SELECT FormId FROM FormMaster_dtl WHERE FormId = @FormId AND UserId = @UserId");

    if (!checkResult.recordset.length) {
      return res.status(404).json({ error: "Form not found" });
    }

    await pool
      .request()
      .input("FormId", sql.Int, req.params.id)
      .query(`
        UPDATE FormMaster_dtl
        SET Active = 0
        WHERE FormId = @FormId
      `);

    res.json({ message: "Form soft deleted successfully" });
  } catch (err) {
    console.error("Soft Delete Error:", err);
    res.status(500).json({ error: "Failed to soft delete form" });
  }
});

// ---------------- Get all active forms ----------------
router.get("/", verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;

    // Automatically deactivate forms where Enddate has passed
    await pool
      .request()
      .input("UserId", sql.Int, req.user.UserId)
      .query(`
        UPDATE FormMaster_dtl
        SET Active = 0
        WHERE UserId = @UserId AND Enddate < GETDATE() AND Active = 1
      `);

    const result = await pool
      .request()
      .input("UserId", sql.Int, req.user.UserId)
      .query(`
        SELECT
          f.FormId,
          f.FormName,
          r.Name AS UserName,
          FORMAT(CreatedDate,'dd-MMM-yyyy') AS CreatedDate,
          FORMAT(Enddate,'dd-MMM-yyyy') AS Enddate,
          f.Fee,
          CAST(f.Active AS INT) AS Active,
          f.ImageOrLogo
        FROM FormMaster_dtl f
        LEFT JOIN Register_dtl r ON f.UserId = r.Id
        WHERE f.UserId = @UserId
        ORDER BY f.FormId ASC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error("Fetch Forms Error:", err);
    res.status(500).json({ error: "Failed to fetch forms" });
  }
});

module.exports = router;