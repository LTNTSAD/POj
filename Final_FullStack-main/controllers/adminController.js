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

  report: (req, res) => {
    console.log('[adminController.report] invoked. session=', !!(req && req.session && req.session.customer));
    const db = require('../Database/Database');
    const stats = {};
    // allow optional date filter (daily/weekly/monthly) via query param 'range' (not used in queries yet)
    const { range } = req.query;
    db.serialize(() => {
      // total revenue for paid payments
      db.get("SELECT SUM(amount) AS totalRevenuePaid FROM Payments WHERE payment_status='Paid'", (err0, r0) => {
        stats.totalRevenuePaid = (r0 && r0.totalRevenuePaid) || 0;
        // total parcels count
        db.get('SELECT COUNT(*) AS parcelCount FROM Parcels', (err1, r1) => {
          stats.totalParcels = (r1 && r1.parcelCount) || 0;
          // pending COD amount (still pending)
          db.get(
            "SELECT SUM(amount) AS pendingCOD FROM Payments WHERE payment_status = 'Pending' AND payment_method = 'COD'",
            (err2, r2) => {
              stats.pendingCOD = (r2 && r2.pendingCOD) || 0;
              // success rate: delivered or shipped vs all
              db.get(
                "SELECT SUM(CASE WHEN status IN ('Delivered','Shipped') THEN 1 ELSE 0 END) AS successCount, COUNT(*) AS totalCount FROM Parcels",
                (err3, r3) => {
                  stats.successCount = (r3 && r3.successCount) || 0;
                  stats.totalCount = (r3 && r3.totalCount) || 0;
                  stats.successRate = stats.totalCount ? stats.successCount / stats.totalCount : 0;
                  // revenue by payment method (COD vs Online)
                  db.all(
                    "SELECT payment_method, SUM(amount) AS total FROM Payments GROUP BY payment_method",
                    (err4, rows4) => {
                      stats.revenueByMethod = rows4 || [];
                      // COD shipped/delivered but unpaid
                      db.all(
                        `SELECT p.payment_id, p.amount, par.status, p.payment_status
                         FROM Payments p
                         JOIN Parcels par ON p.parcel_id = par.parcel_id
                         WHERE p.payment_method='COD' AND p.payment_status='Pending' AND par.status IN ('Shipped','Delivered')`,
                        (err5, rows5) => {
                          stats.codOutstanding = rows5 || [];
                          // parcels pending/ready older than 7 days
                          db.get(
                            "SELECT COUNT(*) AS overdueCount FROM Parcels WHERE status IN ('Ready to Ship','Pending') AND datetime(created_at) <= datetime('now','-7 days')",
                            (err6, r6) => {
                              stats.overdueCount = (r6 && r6.overdueCount) || 0;
                              // tracking logs by location
                              db.all(
                                'SELECT location, COUNT(*) AS count FROM Tracking GROUP BY location ORDER BY count DESC',
                                (err7, rows7) => {
                                  stats.trackLocations = rows7 || [];
                                  // top customers by parcel count
                                  db.all(
                                    `SELECT c.customer_name, COUNT(*) AS sentCount
                                     FROM Parcels par
                                     JOIN Customers c ON par.sender_id = c.customer_id
                                     GROUP BY par.sender_id
                                     ORDER BY sentCount DESC
                                     LIMIT 5`,
                                    (err8, rows8) => {
                                      stats.topCustomers = rows8 || [];
                                      // latest 10 parcels with sender name
                                      db.all(
                                        `SELECT par.parcel_id, par.receiver_name, par.created_at, c.customer_name AS sender_name
                                         FROM Parcels par
                                         LEFT JOIN Customers c ON par.sender_id = c.customer_id
                                         ORDER BY par.created_at DESC
                                         LIMIT 10`,
                                        (err9, rows9) => {
                                          stats.latestParcels = rows9 || [];
                                          res.render('report', { stats, range });
                                        }
                                      );
                                    }
                                  );
                                }
                              );
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        });
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
