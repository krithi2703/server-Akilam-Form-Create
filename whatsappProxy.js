const express = require('express');
const axios = require('axios');
const router = express.Router();

router.post('/send-whatsapp', async (req, res) => {
    const { number, message } = req.body;

    if (!number || !message) {
        return res.status(400).json({ message: 'Number and message are required' });
    }

    try {
        const response = await axios.post('https://wav5.algotechnosoft.com/api/send', {
            number: number,
            type: 'text',
            message: message,
            instance_id: '68D0F8C9EDCA2',
            access_token: '675fece35d27f'
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error proxying WhatsApp request:', error);
        res.status(500).json({ message: 'Failed to send WhatsApp message' });
    }
});

module.exports = router;
