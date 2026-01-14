import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http2 from 'http2';
import http from 'http';
import { Readable, PassThrough } from 'stream';

import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import clientsRoutes from './routes/clients.js';
import projectsRoutes from './routes/projects.js';
import tasksRoutes from './routes/tasks.js';
import entriesRoutes from './routes/entries.js';
import settingsRoutes from './routes/settings.js';
import ldapRoutes from './routes/ldap.js';
import generalSettingsRoutes from './routes/general-settings.js';
import productsRoutes from './routes/products.js';
import quotesRoutes from './routes/quotes.js';
import workUnitsRoutes from './routes/work-units.js';
import salesRoutes from './routes/sales.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Add logging for request body parsing
app.use(express.json());
app.use((req, res, next) => {
  console.log('[Express] Request:', req.method, req.url);
  console.log('[Express] Body parsed:', Object.keys(req.body || {}));
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/entries', entriesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/ldap', ldapRoutes);
app.use('/api/general-settings', generalSettingsRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/work-units', workUnitsRoutes);
app.use('/api/sales', salesRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Helper function to convert HTTP/2 request to Express-compatible format
function convertH2Request(h2Req, h2Res) {
  console.log('[HTTP/2] Converting request:', h2Req.method, h2Req.path || h2Req.url);
  
  // Copy HTTP/2 request headers
  const headers = {};
  for (const [key, value] of Object.entries(h2Req.headers)) {
    headers[key.toLowerCase()] = value;
  }
  
  // Create a minimal mock socket
  const mockSocket = {
    encrypted: false,
    readable: true,
    writable: true,
    remoteAddress: h2Req.socket?.remoteAddress || '127.0.0.1',
    remotePort: h2Req.socket?.remotePort || 80,
    destroy: () => {},
    on: (event, listener) => mockSocket,
    emit: () => {},
    removeListener: () => {},
    addListener: () => mockSocket,
    once: () => mockSocket
  };
  
  // Create IncomingMessage with proper initialization
  const req = new http.IncomingMessage(mockSocket);
  
  // Set basic properties
  req.method = h2Req.method || 'GET';
  req.url = h2Req.path || h2Req.url || '/';
  req.httpVersion = '2.0';
  req.httpVersionMajor = 2;
  req.httpVersionMinor = 0;
  req.headers = headers;
  req.socket = mockSocket;
  req.connection = mockSocket;
  
  // Pipe HTTP/2 stream directly to req
  // This is simpler and more reliable than using PassThrough
  h2Req.on('data', (chunk) => {
    console.log('[HTTP/2] Received chunk:', chunk.length, 'bytes');
    req.push(chunk);
  });
  
  h2Req.on('end', () => {
    console.log('[HTTP/2] Request body ended');
    req.push(null);
  });
  
  h2Req.on('error', (err) => {
    console.error('[HTTP/2] Request error:', err);
    req.emit('error', err);
  });
  
  // Create a response object that mimics http.ServerResponse
  const res = {};
  
  // Track response state
  let statusCode = 200;
  let statusMessage = 'OK';
  let headersSent = false;
  let finished = false;
  
  // Define properties with getters/setters
  Object.defineProperty(res, 'statusCode', {
    get: () => statusCode,
    set: (val) => { statusCode = val; },
    enumerable: true,
    configurable: true
  });
  
  Object.defineProperty(res, 'statusMessage', {
    get: () => statusMessage,
    set: (val) => { statusMessage = val; },
    enumerable: true,
    configurable: true
  });
  
  Object.defineProperty(res, 'headersSent', {
    get: () => headersSent,
    set: (val) => { headersSent = val; },
    enumerable: true,
    configurable: true
  });
  
  Object.defineProperty(res, 'finished', {
    get: () => finished,
    set: (val) => { finished = val; },
    enumerable: true,
    configurable: true
  });
  
  // Implement Express response methods
  res.status = function(code) {
    this.statusCode = code;
    return this;
  };
  
  res.setHeader = function(name, value) {
    h2Res.setHeader(name, value);
  };
  
  res.getHeader = function(name) {
    return h2Res.getHeader(name);
  };
  
  res.removeHeader = function(name) {
    h2Res.removeHeader(name);
  };
  
  res.getHeaders = function() {
    return h2Res.getHeaders();
  };
  
  res.writeHead = function(code, msg, headers) {
    if (!headersSent) {
      statusCode = code;
      if (typeof msg === 'string') {
        statusMessage = msg;
      } else if (msg) {
        headers = msg;
      }
      if (headers) {
        Object.entries(headers).forEach(([key, value]) => {
          h2Res.setHeader(key, value);
        });
      }
      h2Res.writeHead(code, headers);
      headersSent = true;
    }
  };
  
  res.write = function(chunk, encoding, callback) {
    if (!headersSent) {
      res.writeHead(statusCode);
    }
    return h2Res.write(chunk, encoding, callback);
  };
  
  res.end = function(chunk, encoding, callback) {
    if (!headersSent) {
      res.writeHead(statusCode);
    }
    finished = true;
    if (chunk) {
      h2Res.end(chunk, encoding, callback);
    } else {
      h2Res.end(encoding, callback);
    }
  };
  
  res.json = function(obj) {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify(obj));
  };
  
  res.send = function(data) {
    if (typeof data === 'object' && !Buffer.isBuffer(data) && data !== null) {
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/json');
      }
      res.end(JSON.stringify(data));
    } else {
      res.end(data);
    }
  };
  
  return { req, res };
}

// Create HTTP/2 server with HTTP/1.1 fallback support
const server = http2.createServer({
  allowHTTP1: true
}, async (req, res) => {
  // Check if this is an HTTP/2 request
  if (req instanceof http2.Http2ServerRequest) {
    console.log('[HTTP/2] Server received request');
    try {
      const { req: expressReq, res: expressRes } = convertH2Request(req, res);
      console.log('[HTTP/2] Passing to Express');
      app(expressReq, expressRes);
      console.log('[HTTP/2] Express handler called');
    } catch (err) {
      console.error('[HTTP/2] Error converting HTTP/2 request:', err);
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  } else {
    // HTTP/1.1 request - use Express directly
    console.log('[HTTP/1.1] Server received request');
    app(req, res);
  }
});

// Startup function
async function startServer() {
  try {
    // Run automatic migration on startup
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const schemaPath = path.join(__dirname, 'db', 'schema.sql');

    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      // Import query from db module dynamically to ensure it's loaded
      const { query } = await import('./db/index.js');
      // Split by semicolon and run each to be safer and see progress, 
      // but simple query(schemaSql) also works for multiple statements in pg.
      await query(schemaSql);

      // Explicitly verify that the new tables exist
      const tableCheck = await query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name IN ('user_clients', 'user_projects', 'user_tasks')
      `);

      const foundTables = tableCheck.rows.map(r => r.table_name);
      console.log(`Database schema verified. Found tables: ${foundTables.join(', ')}`);

      if (!foundTables.includes('user_clients')) {
        console.error('CRITICAL: user_clients table was not created!');
      }
    } else {
      console.warn('Schema file not found at:', schemaPath);
    }
  } catch (err) {
    console.error('Failed to run auto-migration:', err);
  }

  // Start the HTTP/2 server
  server.listen(PORT, () => {
    console.log(`Praetor API server running on port ${PORT} (HTTP/2 cleartext enabled)`);
  });

  // Periodic LDAP Sync Task (every hour)
  try {
    const ldapService = (await import('./services/ldap.js')).default;

    // Run once on startup if enabled (wait a bit for DB to settle if needed, but here is fine after migration)
    // Actually, let's just schedule it.

    const SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour
    setInterval(async () => {
      try {
        // Reload config to check if enabled
        await ldapService.loadConfig();
        if (ldapService.config && ldapService.config.enabled) {
          console.log('Running periodic LDAP sync...');
          await ldapService.syncUsers();
        }
      } catch (err) {
        console.error('Periodic LDAP Sync Error:', err.message);
      }
    }, SYNC_INTERVAL);
  } catch (err) {
    console.error('Failed to initialize LDAP sync task:', err);
  }
}

startServer();

export default app;
