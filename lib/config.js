const path = require('path');

const rootDir = path.join(__dirname, '..');
const isTest = process.env.NODE_ENV === 'test';

const config = {
  rootDir,
  dataDir: path.join(rootDir, 'data'),
  isTest,
  gatewayPort: Number(process.env.PORT || process.env.GATEWAY_PORT || (isTest ? 4100 : 3000)),
  userServicePort: Number(process.env.USER_SERVICE_PORT || (isTest ? 4101 : 3001)),
  bookServicePort: Number(process.env.BOOK_SERVICE_PORT || (isTest ? 4102 : 3002)),
  borrowServicePort: Number(process.env.BORROW_SERVICE_PORT || (isTest ? 4103 : 3003)),
  jwtSecret: process.env.JWT_SECRET || 'library-demo-local-secret-change-before-deploy',
  internalServiceSecret: process.env.INTERNAL_SERVICE_SECRET || 'library-demo-internal-secret',
  dbPath(name) {
    return path.join(this.dataDir, `${name}${this.isTest ? '-test' : ''}.db`);
  }
};

module.exports = config;
