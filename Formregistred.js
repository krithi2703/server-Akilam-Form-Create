const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('./dbConfig');
const jwt = require('jsonwebtoken');
const sendEmail = require('./emailService');

const JWT_SECRET = process.env.JWT_SECRET;
const otps = new Map();

// ---------------------- INSERT: Register user (provisional) ----------------------
router.post('/insert', async (req, res) => {
    const { identifier, formId, type } = req.body;

    if (!identifier || !formId) {
        return res.status(400).json({ message: 'Identifier and Form ID are required' });
    }

    try {
        const pool = await poolPromise;

        const checkUser = await pool.request()
            .input('Emailormobileno', sql.VarChar, identifier)
            .query('SELECT * FROM FormRegister_dtl WHERE Emailormobileno = @Emailormobileno');

        if (checkUser.recordset.length > 0) {
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
            const result = await pool.request()
                .input('Emailormobileno', sql.VarChar, identifier)
                .input('IsActive', sql.Bit, 1)
                .input('isVerified', sql.Bit, 0)
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

// ---------------------- SEND OTP ----------------------
router.post('/send-otp', async (req, res) => {
    const { identifier, type } = req.body;

    if (!identifier || !type) {
        return res.status(400).json({ message: 'Identifier and type are required' });
    }

    try {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otps.set(identifier, { otp, expiresAt: Date.now() + 10 * 60 * 1000 }); // 10 minutes expiry

        if (type === 'phone') {
            // This is where you would integrate with a WhatsApp API provider
            // For now, we will just log the OTP
            console.log(`WhatsApp OTP for ${identifier}: ${otp}`);
            res.status(200).json({ message: 'OTP sent to your phone number.' });
        } else if (type === 'email') {
            const subject = 'Email Verification OTP';
            const text = `Your OTP for email verification is: ${otp}`;
            sendEmail(identifier, subject, text);
            res.status(200).json({ message: 'OTP sent to your email address.' });
        } else {
            res.status(400).json({ message: 'Invalid OTP type' });
        }
    } catch (err) {
        console.error('Error sending OTP:', err);
        res.status(500).json({
            message: 'Server error while sending OTP',
            error: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

// ---------------------- VERIFY OTP ----------------------
router.post('/verify-otp', async (req, res) => {
    const { identifier, otp } = req.body;

    if (!identifier || !otp) {
        return res.status(400).json({ message: 'Identifier and OTP are required' });
    }

    try {
        const storedOtpData = otps.get(identifier);

        if (!storedOtpData) {
            return res.status(400).json({ message: 'Invalid OTP or OTP expired' });
        }

        if (storedOtpData.expiresAt < Date.now()) {
            otps.delete(identifier);
            return res.status(400).json({ message: 'OTP expired' });
        }

        if (storedOtpData.otp !== otp) {
            return res.status(400).json({ message: 'Invalid OTP' });
        }

        otps.delete(identifier);

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

        await pool.request()
            .input('Emailormobileno', sql.VarChar, identifier)
            .input('FirebaseUID', sql.VarChar, otp)
            .query(`
                UPDATE FormRegister_dtl 
                SET isVerified = 1,
                    FireBaseUID = @FirebaseUID
                WHERE Emailormobileno = @Emailormobileno
            `);

        res.status(200).json({ message: 'OTP verified successfully.', token: token, id: user.Emailormobileno });

    } catch (err) {
        console.error('Server error during OTP verification:', err);
        res.status(500).json({
            message: 'Server error during OTP verification',
            error: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

module.exports = router;