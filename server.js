const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const { Pool } = require('/Users/ugurugurlu/StudioProjects/adisyonex/node_modules/pg');

const pool = new Pool({
  database: 'restro',
  max: 5,
  idleTimeoutMillis: 10000,
});

const PORT = 4141;
const BASE_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Normalize Turkish & international phone numbers
function getPhoneVariants(raw) {
  if (!raw) return [];
  const digits = raw.replace(/\D/g, '');
  const variants = new Set();
  variants.add(raw.trim());
  variants.add(digits);
  if (digits.length === 10) {
    variants.add('0' + digits);
    variants.add('+90' + digits);
    variants.add('90' + digits);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    variants.add(digits.slice(1));
    variants.add('+90' + digits.slice(1));
    variants.add('90' + digits.slice(1));
  } else if (digits.length === 12 && digits.startsWith('90')) {
    variants.add(digits.slice(2));
    variants.add('0' + digits.slice(2));
    variants.add('+' + digits);
  }
  return Array.from(variants);
}

// Get all registered businesses for quick selection
async function getRegisteredFirms() {
  const res = await pool.query(`
    SELECT r.id, r.name, r.city, r.slug, u.phone as owner_phone, u.name as owner_name
    FROM "Restaurant" r
    JOIN "User" u ON r."ownerId" = u.id
    WHERE r."isActive" = true
    ORDER BY r.name ASC
  `);
  return res.rows;
}

// Resolve firm strictly from phone
async function resolveFirmByPhone(phoneInput) {
  const variants = getPhoneVariants(phoneInput);
  if (variants.length === 0) return null;

  // 1. Check if user is owner of a restaurant
  const ownerRes = await pool.query(`
    SELECT r.*, u.id as user_id, u.name as user_name, u.phone as user_phone, u.email as user_email, u.role as user_role
    FROM "User" u
    JOIN "Restaurant" r ON r."ownerId" = u.id
    WHERE u.phone = ANY($1::text[])
    LIMIT 1
  `, [variants]);

  if (ownerRes.rows.length > 0) {
    const row = ownerRes.rows[0];
    return {
      type: 'OWNER',
      user: {
        id: row.user_id,
        name: row.user_name,
        phone: row.user_phone,
        email: row.user_email,
        role: row.user_role
      },
      restaurant: row
    };
  }

  // 2. Check if phone belongs to a staff member
  const staffRes = await pool.query(`
    SELECT s.*, r.id as rest_id, r.name as rest_name, r.city as rest_city, r.slug as rest_slug, r."licensePlan", r."licenseStatus"
    FROM "Staff" s
    JOIN "Restaurant" r ON s."restaurantId" = r.id
    WHERE s.phone = ANY($1::text[])
    LIMIT 1
  `, [variants]);

  if (staffRes.rows.length > 0) {
    const row = staffRes.rows[0];
    return {
      type: 'STAFF',
      user: {
        id: row.id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        role: row.role === 'MANAGEMENT' ? 'MANAGER' : row.role
      },
      restaurant: {
        id: row.rest_id,
        name: row.rest_name,
        city: row.rest_city,
        slug: row.rest_slug,
        licensePlan: row.licensePlan,
        licenseStatus: row.licenseStatus
      }
    };
  }

  return null;
}

// Compute dashboard metrics
async function getDashboardData(phoneInput) {
  const resolved = await resolveFirmByPhone(phoneInput);
  if (!resolved) {
    const registered = await getRegisteredFirms();
    return {
      success: false,
      error: 'FIRM_NOT_FOUND',
      message: 'Bu telefon numarasına ait kayıtlı bir AdisyonEx işletmesi bulunamadı.',
      availableFirms: registered
    };
  }

  const { user, restaurant } = resolved;
  const restaurantId = restaurant.id;

  // Staff
  const staffRes = await pool.query(
    'SELECT id, "employeeCode", name, role, status, phone, "jobTitle" FROM "Staff" WHERE "restaurantId" = $1 ORDER BY CASE WHEN role = \'MANAGEMENT\' THEN 1 WHEN role = \'WAITER\' THEN 2 ELSE 3 END, name ASC',
    [restaurantId]
  );

  // Tables
  const tablesRes = await pool.query(
    'SELECT id, label, section, seats, "isActive" FROM "DiningTable" WHERE "restaurantId" = $1 ORDER BY "sortOrder" ASC, label ASC',
    [restaurantId]
  );

  // Orders
  const ordersRes = await pool.query(
    'SELECT id, "orderNumber", "orderType", status, "tableLabel", "tableId", "subtotal", "taxTotal", "discountTotal", "grandTotal", "createdAt", "settledAt" FROM "Order" WHERE "restaurantId" = $1 ORDER BY "createdAt" DESC',
    [restaurantId]
  );

  // Items
  const itemsRes = await pool.query(
    'SELECT id, "orderId", name, quantity, "unitPrice", state FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "restaurantId" = $1)',
    [restaurantId]
  );

  // Payments
  const paymentsRes = await pool.query(
    'SELECT id, "orderId", mode, amount, "createdAt" FROM "Payment" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "restaurantId" = $1)',
    [restaurantId]
  );

  // Stock
  const stockRes = await pool.query(
    'SELECT id, name, unit, category, "onHand" FROM "StockItem" WHERE "restaurantId" = $1',
    [restaurantId]
  );

  const orders = ordersRes.rows;
  const settledOrders = orders.filter(o => o.status === 'COMPLETED');
  const openOrders = orders.filter(o => o.status === 'OPEN');

  let totalSales = 0;
  for (const o of settledOrders) {
    totalSales += Number(o.grandTotal || 0);
  }

  let cashTotal = 0;
  let cardTotal = 0;
  for (const p of paymentsRes.rows) {
    const amt = Number(p.amount || 0);
    if (p.mode === 'CASH') cashTotal += amt;
    else if (p.mode === 'CARD') cardTotal += amt;
  }

  let openOrdersValue = 0;
  const occupiedTableIds = new Set();
  const openTableLabels = [];

  for (const o of openOrders) {
    const orderItems = itemsRes.rows.filter(i => i.orderId === o.id && i.state !== 'VOID');
    const orderSum = orderItems.reduce((sum, it) => sum + Number(it.unitPrice) * it.quantity, 0);
    openOrdersValue += (Number(o.grandTotal) > 0 ? Number(o.grandTotal) : orderSum);
    if (o.tableId) occupiedTableIds.add(o.tableId);
    if (o.tableLabel && !openTableLabels.includes(o.tableLabel)) openTableLabels.push(o.tableLabel);
  }

  const tableTotal = tablesRes.rows.length;
  const occupiedCount = occupiedTableIds.size;
  const occupancyPercent = tableTotal > 0 ? Math.round((occupiedCount / tableTotal) * 100) : 0;
  const aov = settledOrders.length > 0 ? Math.round((totalSales / settledOrders.length) * 100) / 100 : 0;

  const detailedOrders = orders.map(o => {
    const items = itemsRes.rows.filter(i => i.orderId === o.id);
    const orderPayments = paymentsRes.rows.filter(p => p.orderId === o.id);
    const computedTotal = Number(o.grandTotal) > 0 ? Number(o.grandTotal) : items.reduce((s, it) => s + Number(it.unitPrice) * it.quantity, 0);
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      orderType: o.orderType,
      status: o.status,
      tableLabel: o.tableLabel || (o.orderType === 'TAKEAWAY' ? 'Paket Servis' : 'Masasız'),
      tableId: o.tableId,
      total: computedTotal,
      createdAt: o.createdAt,
      settledAt: o.settledAt,
      paymentMode: orderPayments.length > 0 ? orderPayments[0].mode : null,
      items: items.map(i => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice),
        state: i.state
      }))
    };
  });

  return {
    success: true,
    timestamp: new Date().toISOString(),
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
    },
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      username: restaurant.username,
      city: restaurant.city || 'İstanbul',
      licensePlan: restaurant.licensePlan || 'TRIAL',
      licenseStatus: restaurant.licenseStatus || 'ACTIVE',
      slug: restaurant.slug
    },
    metrics: {
      todaySales: totalSales,
      todayOrdersCount: settledOrders.length,
      aov: aov,
      cashTotal: cashTotal,
      cardTotal: cardTotal,
      openOrdersCount: openOrders.length,
      openOrdersValue: openOrdersValue,
      openTableLabels: openTableLabels,
      occupancy: {
        occupied: occupiedCount,
        total: tableTotal,
        percent: occupancyPercent
      }
    },
    staff: staffRes.rows.map(s => ({
      id: s.id,
      name: s.name,
      employeeCode: s.employeeCode,
      role: s.role,
      status: s.status,
      phone: s.phone,
      jobTitle: s.jobTitle
    })),
    tables: tablesRes.rows.map(t => ({
      id: t.id,
      label: t.label,
      section: t.section,
      seats: t.seats,
      isOccupied: occupiedTableIds.has(t.id)
    })),
    orders: detailedOrders,
    stock: stockRes.rows.map(st => ({
      id: st.id,
      name: st.name,
      unit: st.unit,
      category: st.category,
      onHand: Number(st.onHand)
    }))
  };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:4141'}`);
  const pathname = parsedUrl.pathname;

  // 1. API: Check phone lookup in real-time
  if (pathname === '/api/check-phone') {
    const phone = parsedUrl.searchParams.get('phone') || '';
    const resolved = await resolveFirmByPhone(phone);
    if (!resolved) {
      const registered = await getRegisteredFirms();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ found: false, availableFirms: registered }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        found: true,
        user: resolved.user,
        restaurant: {
          id: resolved.restaurant.id,
          name: resolved.restaurant.name,
          city: resolved.restaurant.city,
          licensePlan: resolved.restaurant.licensePlan
        }
      }));
    }
    return;
  }

  // 2. API: Live dashboard data
  if (pathname === '/api/live-data' || pathname === '/api/dashboard') {
    try {
      const phone = parsedUrl.searchParams.get('phone') || '05550570368';
      const data = await getDashboardData(phone);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    } catch (err) {
      console.error('API Error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 3. API: Auth Login
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const phone = payload.phone || '';
        const resolved = await resolveFirmByPhone(phone);
        if (!resolved) {
          const registered = await getRegisteredFirms();
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            error: 'OTP_USER_NOT_FOUND',
            message: 'Bu telefon numarasına ait kayıtlı bir AdisyonEx işletmesi bulunamadı.',
            availableFirms: registered
          }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          otpSent: true,
          demoOtp: '1923',
          user: resolved.user,
          restaurant: {
            id: resolved.restaurant.id,
            name: resolved.restaurant.name,
            city: resolved.restaurant.city,
            licensePlan: resolved.restaurant.licensePlan,
            licenseStatus: resolved.restaurant.licenseStatus
          }
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 4. API: Registered firms list
  if (pathname === '/api/firms') {
    const firms = await getRegisteredFirms();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, firms }));
    return;
  }

  // 5. PWA CANONICAL ROUTING: Never 404 on PWA entry points
  if (
    pathname === '/' ||
    pathname === '/mobil/patron' ||
    pathname === '/mobil/patron/' ||
    pathname === '/patron' ||
    pathname === '/patron/' ||
    pathname === '/index.html'
  ) {
    const htmlPath = path.join(BASE_DIR, 'mobil/patron/index.html');
    fs.readFile(htmlPath, 'utf-8', (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error reading index.html');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
    return;
  }

  // Service Worker header
  if (pathname === '/sw.js') {
    const swPath = path.join(BASE_DIR, 'sw.js');
    fs.readFile(swPath, 'utf-8', (err, data) => {
      if (err) { res.writeHead(404); res.end('SW not found'); return; }
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Service-Worker-Allowed': '/',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
    return;
  }

  // Static File Serving
  let filePath = path.join(BASE_DIR, pathname);
  fs.stat(filePath, (err, stats) => {
    if (err) {
      // Check if file exists inside /mobil/patron/
      const subPath = path.join(BASE_DIR, 'mobil/patron', pathname);
      if (fs.existsSync(subPath) && fs.statSync(subPath).isFile()) {
        filePath = subPath;
      } else {
        // SPA Fallback for PWA: return index.html for non-asset routes
        if (!path.extname(pathname)) {
          const htmlPath = path.join(BASE_DIR, 'mobil/patron/index.html');
          fs.readFile(htmlPath, 'utf-8', (errHtml, htmlData) => {
            if (!errHtml) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(htmlData);
              return;
            }
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
          });
          return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found: ' + pathname);
        return;
      }
    } else if (stats.isDirectory()) {
      const tryIndex = path.join(filePath, 'index.html');
      if (fs.existsSync(tryIndex)) {
        filePath = tryIndex;
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Directory Index Missing');
        return;
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[AdisyonEx Live Node Server] running at http://localhost:${PORT}/mobil/patron/`);
});
