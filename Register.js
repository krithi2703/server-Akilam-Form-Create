const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { sql, poolPromise } = require('./dbConfig');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

// ---------------- Register ----------------
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'All fields are required' });

  try {
    const pool = await poolPromise;

    const checkUser = await pool.request()
      .input('Email', sql.VarChar, email)
      .query('SELECT Email FROM Register_dtl WHERE Email = @Email');

    if (checkUser.recordset.length > 0) return res.status(400).json({ message: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.request()
      .input('Name', sql.VarChar, name)
      .input('Email', sql.VarChar, email)
      .input('Password', sql.VarChar, hashedPassword)
      .input('UserRole', sql.Int, 2)
      .input('IsActive', sql.Bit, 1)
      .query(`INSERT INTO Register_dtl (Name, Email, Password, UserRole, IsActive) OUTPUT INSERTED.Id, INSERTED.Name, INSERTED.Email, INSERTED.UserRole VALUES (@Name,@Email,@Password,@UserRole,@IsActive)`);

    const newUser = result.recordset[0];

    res.status(201).json({ id: newUser.Id, name: newUser.Name, email: newUser.Email, userRole: newUser.UserRole });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------- Login ----------------
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('Email', sql.VarChar, email)
      .query('SELECT r.Id, r.Name, r.Password, u.UserRole FROM Register_dtl r INNER JOIN UserTable_dtl u ON r.UserRole = u.id WHERE r.Email=@Email AND r.IsActive=1');

    if (result.recordset.length === 0) return res.status(400).json({ message: 'Invalid credentials or inactive account' });

    const user = result.recordset[0];

    const isMatch = await bcrypt.compare(password, user.Password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials or inactive account' });

    // Create a JWT token
    const token = jwt.sign({ id: user.Id, name: user.Name, userRole: user.UserRole }, JWT_SECRET, { expiresIn: '8h' });

    res.status(200).json({ id: user.Id, name: user.Name, userRole: user.UserRole, token: token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------- Get Total Users Count ----------------
router.get('/count', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .query('SELECT COUNT(*) AS totalUsers FROM Register_dtl');

    res.status(200).json({ totalUsers: result.recordset[0].totalUsers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------- Get All Users ----------------
router.get('/', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .query('SELECT Id, Name, Email, UserRole, IsActive FROM Register_dtl');

    res.status(200).json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
