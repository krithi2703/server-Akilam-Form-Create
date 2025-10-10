require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ---------------- Import Routers ----------------
const columnsRouter = require('./columnsRoutes');
const registerRouter = require('./Register');
const masterRouter = require('./MaterPage');
const formDetailsRouter = require('./FormSequenceDetails');
const updateRouter = require('./ReturnedUpdate');
const formvaluesRouter = require('./FormValues');
const formregisterRouter = require('./Formregistred');
const dropdownDtlRouter = require('./dropdownDtlRoutes');
const radioBoxDtlRouter = require('./radioBoxDtlRoutes');
const checkBoxDtlRouter = require('./checkBoxDtlRoutes');
const formNameRoutes = require('./formNameRoutes');
const validation = require('./Validation');
const submissionsRouter = require('./submissionsRoutes');
const contentDtlRouter = require('./contentDtlRoutes');
const { registerRazorpayRoutes } = require('./razorpay');
const whatsappProxyRouter = require('./whatsappProxy');

const app = express();

//const PORT = process.env.PORT || 5000;
const PORT = process.env.PORT || 8500;

// ---------------- Middleware ----------------
//const allowedOrigins = ['http://136.185.14.8:5558', process.env.FRONTEND_URL];
//onst allowedOrigins = ['http://localhost:5173', process.env.FRONTEND_URL];
const allowedOrigins = ['http://103.185.75.196:5558', process.env.FRONTEND_URL];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'userid'],
    credentials: true,
  })
);

app.use(express.json());

// ---------------- Logging ----------------
const accessLogStream = fs.createWriteStream(
  path.join(__dirname, 'request_log.txt'),
  { flags: 'a' }
);
app.use((req, res, next) => {
  const log = `Incoming Request: ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`;
  console.log(log);
  accessLogStream.write(log + '\n');
  next();
});

// ---------------- Razorpay Routes ----------------
registerRazorpayRoutes(app);

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
app.use('/api/formname', formNameRoutes);
app.use('/api/validation', validation);
app.use('/api/submissions', submissionsRouter);
app.use('/api/content-dtl', contentDtlRouter);
app.use('/api', whatsappProxyRouter);

// ---------------- Health Check ----------------
app.get('/api/test', (req, res) => {
  res.json({ message: '✅ Server is reachable!' });
});

// ---------------- 404 Handler for API routes ----------------
app.use('/api/*', (req, res) => {
  res.status(404).json({ message: 'API Route not found' });
});

// ---------------- Serve uploaded files ----------------
app.use('/uploads',express.static(path.join(__dirname, 'public/uploads'))); // For uploaded files

// ---------------- Serve React Frontend ----------------
const clientBuildPath = path.join(__dirname, '..', 'Client', 'dist');
app.use(express.static(clientBuildPath));

// Catchall: send index.html for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
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