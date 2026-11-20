const pool = require('./db');

pool.query('SELECT postgis_full_version();', (err, res) => {
  if (err) {
    console.error('Connection failed:', err.message);
  } else {
    console.log('Connected successfully!');
    console.log(res.rows[0]);
  }
  pool.end();
});