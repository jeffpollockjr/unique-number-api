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

// Delete a specific number
app.delete('/api/delete-number/:number', async (req, res) => {
  try {
    const number = parseInt(req.params.number);
    
    if (isNaN(number) || number < 111111111 || number > 999999999) {
      return res.status(400).json({
        success: false,
        error: 'Invalid number'
      });
    }
    
    const result = await pool.query(
      'DELETE FROM unique_numbers WHERE number = $1 RETURNING *',
      [number]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Number not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Number deleted',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error deleting number:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete numbers older than X days
app.delete('/api/cleanup', async (req, res) => {
  try {
    const daysOld = parseInt(req.query.days) || 1825; // Default 5 years (1825 days)
    
    const result = await pool.query(
      'DELETE FROM unique_numbers WHERE created_at < NOW() - INTERVAL \'1 day\' * $1',
      [daysOld]
    );
    
    const deletedCount = result.rowCount;
    
    res.json({
      success: true,
      message: `Deleted numbers older than ${daysOld} days`,
      deleted_count: deletedCount
    });
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete all numbers (use with caution!)
app.delete('/api/delete-all', async (req, res) => {
  try {
    // Optional: Add authentication check here
    const confirmToken = req.query.confirm;
    
    if (confirmToken !== 'DELETE_ALL_NUMBERS') {
      return res.status(403).json({
        success: false,
        error: 'Must provide confirm=DELETE_ALL_NUMBERS parameter'
      });
    }
    
    const result = await pool.query('DELETE FROM unique_numbers RETURNING count(*)');
    const deletedCount = result.rowCount;
    
    res.json({
      success: true,
      message: 'All numbers deleted',
      deleted_count: deletedCount
    });
  } catch (error) {
    console.error('❌ Error deleting all:', error);
    res.status(500).json({ success: false, error: error.message });
  }
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