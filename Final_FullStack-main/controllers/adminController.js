const Parcel = require('../models/Parcel');
const Payment = require('../models/Payment');

const adminController = {
  dashboard: (req, res) => {
    const db = require('../Database/Database');
    // Get all parcels with sender name joined
    db.all(`
      SELECT pl.*, c.customer_name
      FROM Parcels pl
      JOIN Customers c ON pl.sender_id = c.customer_id
      ORDER BY pl.created_at DESC
    `, (err, parcels) => {
      if (err) return res.render('admin-dashboard', { error: 'DB error', parcels: [] });
      
      // Get all payments with additional info
      db.all(`
        SELECT p.payment_id,
               p.parcel_id,
               p.amount,
               p.payment_method,
               p.payment_status,
               p.payment_date
        FROM Payments p
        ORDER BY p.payment_date DESC
      `, (err2, payments) => {
        if (err2) payments = [];
        res.render('admin-dashboard', { parcels, payments });
      });
    });
  },
  // transition operations
  cancelParcel: (req, res) => {
    const { parcel_id } = req.body;
    const db = require('../Database/Database');
    db.run('UPDATE Parcels SET status = ? WHERE parcel_id = ?', ['Cancelled', parcel_id], () => {
      res.redirect('/admin/dashboard');
    });
  },
  markShipped: (req, res) => {
    const { parcel_id } = req.body;
    const db = require('../Database/Database');
    // update parcel status and record a tracking entry
    db.run('UPDATE Parcels SET status = ? WHERE parcel_id = ?', ['Shipped', parcel_id], function (err) {
      if (!err) {
        // ensure tracking table exists (migration safety)
        db.run(`
          CREATE TABLE IF NOT EXISTS Tracking (
            tracking_id INTEGER PRIMARY KEY AUTOINCREMENT,
            parcel_id INTEGER NOT NULL,
            update_time TEXT DEFAULT (datetime('now')),
            location TEXT,
            description TEXT,
            FOREIGN KEY (parcel_id) REFERENCES Parcels(parcel_id) ON DELETE CASCADE
          )
        `, () => {
          db.run(
            'INSERT INTO Tracking (parcel_id, location, description) VALUES (?, ?, ?)',
            [parcel_id, 'Origin Facility', 'Marked as shipped by admin'],
            () => {
              res.redirect('/admin/dashboard');
            }
          );
        });
      } else {
        res.redirect('/admin/dashboard');
      }
    });
  },
  markDelivered: (req, res) => {
    const { parcel_id } = req.body;
    const db = require('../Database/Database');
    db.run('UPDATE Parcels SET status = ? WHERE parcel_id = ?', ['Delivered', parcel_id], () => {
      res.redirect('/admin/dashboard');
    });
  },
  updatePaymentStatus: (req, res) => {
    const { payment_id, payment_status } = req.body;
    // allow simple set of common values
    const allowed = ['Pending','Paid','Cancelled'];
    const status = allowed.includes(payment_status) ? payment_status : 'Pending';
    const db = require('../Database/Database');
    db.run('UPDATE Payments SET payment_status = ? WHERE payment_id = ?', [status, payment_id], function (err) {
      if (!err && status === 'Paid') {
        // also bump the parcel record
        db.get('SELECT parcel_id FROM Payments WHERE payment_id = ?', [payment_id], (e, row) => {
          if (row && row.parcel_id) {
            db.run('UPDATE Parcels SET status = ? WHERE parcel_id = ?', ['Ready to Ship', row.parcel_id]);
          }
          res.redirect('/admin/dashboard');
        });
      } else {
        res.redirect('/admin/dashboard');
      }
    });
  },

  // allow admin to update parcel status with arbitrary value (validated in form)
  updateStatus: (req, res) => {
    const { parcel_id, status } = req.body;
    const db = require('../Database/Database');
    db.run('UPDATE Parcels SET status = ? WHERE parcel_id = ?', [status, parcel_id], function (err) {
      // if status was changed to shipped from generic form, log it too
      if (!err && status === 'Shipped') {
        db.run('INSERT INTO Tracking (parcel_id, location, description) VALUES (?, ?, ?)',
          [parcel_id, 'Origin Facility', 'Status updated to Shipped'],
          () => {
            res.redirect('/admin/dashboard');
          }
        );
      } else {
        // ignore error and redirect back
        res.redirect('/admin/dashboard');
      }
    });
  },

  // remove a parcel and any associated payment
  deleteParcel: (req, res) => {
    const parcelId = req.body.parcel_id;
    const db = require('../Database/Database');
    // delete tracking entries and payment records before removing the parcel
    db.serialize(() => {
      db.run('DELETE FROM Tracking WHERE parcel_id = ?', [parcelId], () => {
        db.run('DELETE FROM Payments WHERE parcel_id = ?', [parcelId], () => {
          db.run('DELETE FROM Parcels WHERE parcel_id = ?', [parcelId], () => {
            res.redirect('/admin/dashboard');
          });
        });
      });
    });
  }
};

module.exports = adminController;
