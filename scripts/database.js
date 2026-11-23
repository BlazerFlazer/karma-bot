import { DatabaseService } from '../src/database/store.js';
const db = new DatabaseService();
try {
  console.log(process.argv[2] === 'backup' ? db.backup() : 'Миграции применены.');
} finally {
  db.close();
}
