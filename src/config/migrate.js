const { pool } = require('./database');
require('dotenv').config();

async function migrate() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Extension pgvector pour les empreintes faciales
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');

    // ===== TABLE PHOTOGRAPHERS (photographes) =====
    await client.query(`
      CREATE TABLE IF NOT EXISTS photographers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        studio_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        avatar_url TEXT,
        plan VARCHAR(20) DEFAULT 'free',
        photo_limit INTEGER DEFAULT 100,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ===== TABLE EVENTS (événements) =====
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        photographer_id UUID NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        date DATE,
        description TEXT,
        cover_url TEXT,
        status VARCHAR(20) DEFAULT 'draft',
        is_public BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ===== TABLE PHOTOS =====
    await client.query(`
      CREATE TABLE IF NOT EXISTS photos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        photographer_id UUID NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
        original_url TEXT NOT NULL,
        watermarked_url TEXT,
        thumbnail_url TEXT,
        qr_code_id VARCHAR(10) UNIQUE NOT NULL,
        qr_code_url TEXT,
        width INTEGER,
        height INTEGER,
        file_size INTEGER,
        exif_data JSONB DEFAULT '{}',
        faces_count INTEGER DEFAULT 0,
        is_processed BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ===== TABLE FACE_EMBEDDINGS (empreintes faciales) =====
    await client.query(`
      CREATE TABLE IF NOT EXISTS face_embeddings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        embedding vector(512) NOT NULL,
        bbox_x FLOAT,
        bbox_y FLOAT,
        bbox_w FLOAT,
        bbox_h FLOAT,
        confidence FLOAT DEFAULT 0,
        cluster_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ===== TABLE TRANSACTIONS (paiements) =====
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id),
        photographer_id UUID NOT NULL REFERENCES photographers(id),
        client_phone VARCHAR(20) NOT NULL,
        payment_method VARCHAR(20) NOT NULL,
        amount INTEGER NOT NULL,
        currency VARCHAR(5) DEFAULT 'XOF',
        status VARCHAR(20) DEFAULT 'pending',
        provider_transaction_id VARCHAR(255),
        photos_purchased UUID[] DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `);

    // ===== TABLE DOWNLOADS (téléchargements) =====
    await client.query(`
      CREATE TABLE IF NOT EXISTS downloads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id UUID NOT NULL REFERENCES transactions(id),
        photo_id UUID NOT NULL REFERENCES photos(id),
        downloaded_at TIMESTAMP DEFAULT NOW(),
        ip_address VARCHAR(45)
      )
    `);

    // ===== INDEX pour performances =====
    await client.query('CREATE INDEX IF NOT EXISTS idx_photos_event ON photos(event_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_photos_qr ON photos(qr_code_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_face_event ON face_embeddings(event_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_transactions_photographer ON transactions(photographer_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_events_photographer ON events(photographer_id)');

    // Index vectoriel pour recherche de similarité faciale (HNSW — rapide)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_face_embedding_hnsw 
      ON face_embeddings 
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
    `);

    await client.query('COMMIT');
    console.log('Migration terminée avec succès !');
    console.log('Tables créées : photographers, events, photos, face_embeddings, transactions, downloads');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur de migration :', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(console.error);