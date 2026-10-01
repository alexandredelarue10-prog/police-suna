// Usage : npm run hub:hash -- "mon mot de passe"  -> affiche la valeur à mettre dans HUB_PASSWORD_HASH
const bcrypt = require('bcryptjs');
const pwd = process.argv[2];
if (!pwd) { console.error('Usage : npm run hub:hash -- "mot de passe"'); process.exit(1); }
console.log(bcrypt.hashSync(pwd, 12));
