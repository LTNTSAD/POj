const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const parcelRoutes = require('./routes/parcels');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'replace-with-secure-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 }
}));

// expose session to views
app.use((req, res, next) => {
  res.locals.session = req.session;
  res.locals.currentPath = req.path;
  next();
});

app.use('/', authRoutes);
app.use('/parcels', parcelRoutes);
app.use('/admin', adminRoutes);

// helper: list registered routes for debugging
app.get('/__routes', (req, res) => {
  const out = [];
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      // routes registered directly on the app
      out.push(middleware.route.path);
    } else if (middleware.name === 'router' && middleware.handle && middleware.handle.stack) {
      // router middleware
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) out.push(handler.route.path);
      });
    }
  });
  res.json({ routes: out });
});

// convenience redirect so /dashboard works
app.get('/dashboard', (req, res) => {
  if (!req.session || !req.session.customer) return res.redirect('/login');
  if (req.session.customer.role === 'admin') return res.redirect('/admin/dashboard');
  res.redirect('/parcels/dashboard');
});

app.get('/', (req, res) => {
  if (!req.session || !req.session.customer) return res.redirect('/login');
  if (req.session.customer.role === 'admin') return res.redirect('/admin/dashboard');
  res.redirect('/parcels/dashboard');
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

module.exports = app;
