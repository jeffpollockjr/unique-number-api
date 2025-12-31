require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS unique_numbers (
        id SERIAL PRIMARY KEY,
        number BIGINT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        bubble_id TEXT
      );
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_number ON unique_numbers(number);
    `);
    
    console.log('✅ Database initialized');
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

function generateNumber() {
  return Math.floor(111111111 + Math.random() * (999999999 - 111111111 + 1));
}

async function generateUniqueNumber(maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const number = generateNumber();
    
    try {
      const result = await pool.query(
        'INSERT INTO unique_numbers (number) VALUES ($1) RETURNING id, number, created_at',
        [number]
      );
      console.log(`✅ Generated: ${number}`);
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') {
        console.log(`⚠️ ${number} exists, retrying...`);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Failed to generate unique number');
}

app.post('/api/generate-number', async (req, res) => {
  try {
    const uniqueNumber = await generateUniqueNumber();
    
    res.json({
      success: true,
      data: {
        number: uniqueNumber.number,
        id: uniqueNumber.id,
        created_at: uniqueNumber.created_at
      }
    });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/check-number/:number', async (req, res) => {
  try {
    const number = parseInt(req.params.number);
    const result = await pool.query(
      'SELECT * FROM unique_numbers WHERE number = $1',
      [number]
    );
    
    res.json({
      success: true,
      exists: result.rows.length > 0,
      data: result.rows[0] || null
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*) as total FROM unique_numbers'
    );
    
    const total = parseInt(result.rows[0].total);
    const totalPossible = 999999999 - 111111111 + 1;
    const percentageUsed = total > 0 ? ((total / totalPossible) * 100).toFixed(6) : '0';
    
    res.json({
      success: true,
      data: {
        total_generated: total,
        total_possible: totalPossible,
        percentage_used: percentageUsed + '%'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({
    message: 'Unique Number Generator API',
    endpoints: {
      'POST /api/generate-number': 'Generate a new unique number',
      'GET /api/check-number/:number': 'Check if a number exists',
      'GET /api/stats': 'Get generation statistics',
      'GET /health': 'Health check'
    }
  });
});

const PORT = process.env.PORT || 3000;

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});