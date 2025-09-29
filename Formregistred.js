const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('./dbConfig');
const jwt = require('jsonwebtoken');

// TODO: Move this to an environment variable
const JWT_SECRET = process.env.JWT_SECRET;

// ---------------------- INSERT: Register user (provisional) ----------------------
router.post('/insert', async (req, res) => {
    //console.log('Formregistred.js: /insert route hit!');
    const { identifier, formId } = req.body;

    if (!identifier || !formId) {
        return res.status(400).json({ message: 'Identifier and Form ID are required' });
    }

    try {
        const pool = await poolPromise;

        // ✅ Check if the user already exists
        const checkUser = await pool.request()
            .input('Emailormobileno', sql.VarChar, identifier)
            .query('SELECT * FROM FormRegister_dtl WHERE Emailormobileno = @Emailormobileno');

        if (checkUser.recordset.length > 0) {
            // User exists → send token for OTP verification
            const user = checkUser.recordset[0];
            const token = jwt.sign(
                { id: user.Emailormobileno, name: user.Emailormobileno, isFormOnlyUser: true },
                JWT_SECRET,
                { expiresIn: '1h' }
            );

            return res.status(200).json({
                message: 'User already exists. Proceed with OTP verification.',
                token,
                id: user.Emailormobileno,
                isExistingUser: true,
            });
        } else {
            // New user → insert as not verified yet
            const result = await pool.request()
                .input('Emailormobileno', sql.VarChar, identifier)
                .input('IsActive', sql.Bit, 1) // Active
                .input('isVerified', sql.Bit, 0) // Not verified
                .query(`
                    INSERT INTO FormRegister_dtl (Emailormobileno, IsActive, isVerified) 
                    VALUES (@Emailormobileno, @IsActive, @isVerified); 
                    SELECT SCOPE_IDENTITY() AS Id, @Emailormobileno AS Emailormobileno
                `);

            const newUser = result.recordset[0];
            const token = jwt.sign(
                { id: newUser.Emailormobileno, name: newUser.Emailormobileno, isFormOnlyUser: true },
                JWT_SECRET,
                { expiresIn: '1h' }
            );

            return res.status(201).json({
                message: 'User registered provisionally. Please verify OTP.',
                token,
                id: newUser.Emailormobileno,
                isExistingUser: false,
            });
        }
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({
            message: 'Server error',
            error: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

// ---------------------- VERIFY: Finalize registration ----------------------
router.post('/verify', async (req, res) => {
    const { identifier, firebaseUID } = req.body;

    if (!identifier || !firebaseUID) {
        return res.status(400).json({ message: 'Identifier and Firebase UID are required' });
    }

    try {
        const pool = await poolPromise;

        const result = await pool.request()
            .input('Emailormobileno', sql.VarChar, identifier)
            .input('FirebaseUID', sql.VarChar, firebaseUID) // ✅ consistent name
            .query(`
                UPDATE FormRegister_dtl 
                SET isVerified = 1, FireBaseUID = @FirebaseUID 
                WHERE Emailormobileno = @Emailormobileno
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ message: 'User not found or already verified.' });
        }

        res.status(200).json({ message: 'User verified successfully.' });

    } catch (err) {
        console.error('Database error during verification:', err);
        res.status(500).json({
            message: 'Server error during verification',
            error: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

// ---------------------- VERIFY WHATSAPP OTP ----------------------
router.post('/verify-whatsapp-otp', async (req, res) => {
    const { identifier, otp } = req.body;

    if (!identifier || !otp) {
        return res.status(400).json({ message: 'Identifier and OTP are required' });
    }

    try {
        // In a real application, you would retrieve the stored OTP for the identifier
        // from your database and compare it with the received OTP.
        // You would also check for OTP expiry.

        // If OTP is valid, generate a token for the user
        const pool = await poolPromise;
        const result = await pool.request()
            .input('Emailormobileno', sql.VarChar, identifier)
            .query('SELECT * FROM FormRegister_dtl WHERE Emailormobileno = @Emailormobileno');

        if (result.recordset.length === 0) {
            return res.status(404).json({ message: 'User not found after OTP verification' });
        }

        const user = result.recordset[0];
        const token = jwt.sign(
            { id: user.Emailormobileno, name: user.Emailormobileno, isFormOnlyUser: true },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        // Update user as verified in the database (if not already)
        await pool.request()
            .input('Emailormobileno', sql.VarChar, identifier)
            .input('FirebaseUID', sql.VarChar, otp) // No FirebaseUID in this flow

            .query(`
                UPDATE FormRegister_dtl 
                SET isVerified = 1 ,
                    FireBaseUID = @FirebaseUID
                WHERE Emailormobileno = @Emailormobileno AND isVerified = 0
            `);

        res.status(200).json({ message: 'OTP verified successfully.', token: token, id: user.Emailormobileno });

    } catch (err) {
        console.error('Server error during WhatsApp OTP verification:', err);
        res.status(500).json({
            message: 'Server error during OTP verification',
            error: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

module.exports = router;
