const fs = require('fs');

const f = '/home/fotokash-frontend/src/admin/pages/Photographers.css';
let css = fs.readFileSync(f, 'utf8');

// Remplacer la media query existante par une version plus complète
css = css.replace(
  /@media \(max-width: 900px\) \{[^}]*(?:\{[^}]*\}[^}]*)*\}/,
  `@media (max-width: 900px) {
  .photo-layout { flex-direction: column; }
  .photo-detail-panel { width: 100%; position: static; }
  .photo-card-stats { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 768px) {
  .photographers-page { padding: 0; }
  .photo-header { margin-bottom: 16px; }
  .photo-title { font-size: 20px; }
  .photo-subtitle { font-size: 12px; }
  .photo-filters { gap: 8px; margin-bottom: 14px; }
  .photo-search-box { min-width: unset; }
  .photo-search-input { font-size: 13px; padding: 10px 0; }
  .filter-btn { padding: 6px 10px; font-size: 12px; }
  .photo-card { padding: 14px; }
  .photo-card-top { margin-bottom: 10px; }
  .photo-card-stats { grid-template-columns: repeat(2, 1fr); gap: 6px; }
  .photo-detail-panel { padding: 16px; }
  .detail-avatar { width: 48px; height: 48px; font-size: 18px; margin-bottom: 10px; }
  .detail-name { font-size: 16px; }
  .detail-stats-grid { gap: 8px; }
  .detail-stat-value { font-size: 18px; }
  .detail-actions { flex-direction: row; flex-wrap: wrap; }
  .action-btn { flex: 1; min-width: 0; padding: 10px 8px; font-size: 12px; text-align: center; justify-content: center; }
}`
);

fs.writeFileSync(f, css);
console.log('OK: Photographers.css mobile ameliore');
