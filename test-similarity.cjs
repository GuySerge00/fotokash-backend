const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  database: 'fotokash_db',
  user: 'fotokash_user',
  password: 'M$upp0rt49',
});

async function test() {
  // Prendre le premier embedding en base
  var r1 = await pool.query('SELECT embedding FROM face_embeddings LIMIT 1');
  if (r1.rows.length === 0) { console.log('No embeddings'); process.exit(); }
  
  var emb = r1.rows[0].embedding;
  
  // Chercher les similarités avec TOUS les embeddings (sans seuil)
  var r2 = await pool.query(
    "SELECT fe.photo_id, 1 - (fe.embedding <=> $1::vector) as similarity FROM face_embeddings fe ORDER BY similarity DESC LIMIT 10",
    [emb]
  );
  
  console.log('Top 10 similarities (using first embedding as reference):');
  r2.rows.forEach(function(row) {
    console.log('  Photo:', row.photo_id, 'Similarity:', parseFloat(row.similarity).toFixed(4));
  });
  
  pool.end();
}

test();
