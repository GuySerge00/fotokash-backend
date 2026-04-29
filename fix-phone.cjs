const fs = require('fs');
const path = '/home/fotokash-backend/src/routes/events.js';
let c = fs.readFileSync(path, 'utf8');

// Ajouter p.phone dans la requete du slug public
let old = "p.studio_name as photographer_name,";
let newStr = "p.studio_name as photographer_name,\n              p.phone as photographer_phone,";

if (c.includes(old) && !c.includes('photographer_phone')) {
  c = c.replace(old, newStr);
  
  // Ajouter p.phone dans le GROUP BY
  let oldGroup = "p.studio_name, p.plan, sp.mobile_money_enabled, sp.commission_rate";
  let newGroup = "p.studio_name, p.phone, p.plan, sp.mobile_money_enabled, sp.commission_rate";
  c = c.replace(oldGroup, newGroup);
  
  console.log('Phone added to slug route');
} else {
  console.log('Already has phone or not found');
}

fs.writeFileSync(path, c, 'utf8');
console.log('Done');
