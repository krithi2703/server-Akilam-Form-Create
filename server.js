require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ---------------- Import Routers ----------------
const columnsRouter = require('./columnsRoutes');          // Dynamic columns routes
const registerRouter = require('./Register');              // User register/login routes
const masterRouter = require('./MaterPage');               // Master page routes
const formDetailsRouter = require('./FormSequenceDetails');// Form details routes
const updateRouter = require('./ReturnedUpdate');          // Update returned data
const formvaluesRouter = require('./FormValues');          // Form values routes (if needed)
const formregisterRouter = require('./Formregistred');     // Form register routes (if needed)
const dropdownDtlRouter = require('./dropdownDtlRoutes');
const radioBoxDtlRouter = require('./radioBoxDtlRoutes');
const checkBoxDtlRouter = require('./checkBoxDtlRoutes');

const app = express();

// Load port from .env or fallback
const PORT = process.env.PORT || 5000;

// ---------------- Middleware ----------------
app.use(
  cors({
    //origin: 'http://136.185.14.8:5558',   // <-- for prod, update to your frontend host
    origin: 'http://localhost:5173',       // <-- for local dev
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'userid'],
    credentials: true,
  })
);

app.use(express.json()); // Parse JSON requests

// Create a write stream (in append mode)
const accessLogStream = fs.createWriteStream(
  path.join(__dirname, 'request_log.txt'),
  { flags: 'a' }
);

// Logging middleware
app.use((req, res, next) => {
  const log = `Incoming Request: ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`;
  console.log(log);
  accessLogStream.write(log + '\n');
  next();
});

// ---------------- API Routes ----------------
app.use('/api/users', registerRouter);
app.use('/api/columns', columnsRouter);
app.use('/api/formmaster', masterRouter);
app.use('/api/formdetails', formDetailsRouter);
app.use('/api/update', updateRouter);
app.use('/api/formvalues', formvaluesRouter);
app.use('/api/formregister', formregisterRouter);
app.use('/api/dropdown-dtl', dropdownDtlRouter);
app.use('/api/radiobox-dtl', radioBoxDtlRouter);
app.use('/api/checkbox-dtl', checkBoxDtlRouter);

// ---------------- Health Check ----------------
app.get('/api/test', (req, res) => {
  res.json({ message: '✅ Server is reachable!' });
});

// ---------------- 404 Handler for API routes ----------------
// IMPORTANT: must come BEFORE catchall (*)
app.use('/api/*', (req, res) => {
  res.status(404).json({ message: 'API Route not found' });
});

// --- Serve Static Files and Handle SPA Routing ---
const clientBuildPath = path.resolve(__dirname, '..', 'Client', 'dist');
app.use(express.static(clientBuildPath));

// Catchall: send index.html for non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.resolve(clientBuildPath, 'index.html'));
});

// ---------------- Error Handler ----------------
app.use((err, req, res, next) => {
  console.error('🔥 Error:', err.stack);
  res.status(500).json({ message: 'Internal server error' });
});

// ---------------- Start Server ----------------
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
