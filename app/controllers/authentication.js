// const mailchimp = require('../config/mailchimp');
const express = require('express'),
    router = express.Router(),
    mongoose = require('mongoose'),
    crypto = require('crypto'),
    User = mongoose.model('User'),
    config = require('../../config/config'),
    passport = require('passport'),
    helpers = require('../helpers'),
    constsnts = require('../constants'),
    sendGrid = require('../../config/sendgrid')
jwt = require('jsonwebtoken');

module.exports = function (app) {
    app.use('/api', router);
};
// Generate JWT
// TO-DO Add issuer and audience
function generateToken(user) {
    return jwt.sign(user, config.secret, {
        expiresIn: 60 * 60 * 24 * 30 // in seconds
    });
}
const requireAuth = passport.authenticate('jwt', {session: false});
const requireLogin = passport.authenticate('local', {session: false});
//= =======================================
// Login Route
//= =======================================
router.post('/login', requireLogin, (req, res, next) => {
    const userInfo = helpers.setUserInfo(req.user);
    res.status(200).json({
        token: `JWT ${generateToken(userInfo)}`,
        user: userInfo
    });
})


//= =======================================
// Registration Route
//= =======================================
router.post('/register', (req, res, next) => {
    // Check for registration errors
    const email = req.body.email;
    const firstName = req.body.firstName;
    const lastName = req.body.lastName;
    const password = req.body.password;

    // Return error if no email provided
    if (!email) {
        return res.status(422).send({error: 'You must enter an email address.'});
    }

    // Return error if full name not provided
    if (!firstName || !lastName) {
        return res.status(422).send({error: 'You must enter your full name.'});
    }

    // Return error if no password provided
    if (!password) {
        return res.status(422).send({error: 'You must enter a password.'});
    }

    User.findOne({email}, (err, existingUser) => {
        if (err) {
            return next(err);
        }

        // If user is not unique, return error
        if (existingUser) {
            return res.status(422).send({error: 'That email address is already in use.'});
        }

        // If email is unique and password was provided, create account
        const user = new User({
            email,
            password,
            firstName,
            lastName
        });

        user.save((err, user) => {
            if (err) {
                return next(err);
            }

            const userInfo = helpers.setUserInfo(user);
            res.status(201).json({
                token: `JWT ${generateToken(userInfo)}`,
                user: userInfo
            });
        });
    });
});

//= =======================================
// Authorization Middleware
//= =======================================

// Role authorization check
function roleAuthorization(requiredRole) {
    return function (req, res, next) {
        const user = req.user;

        User.findById(user._id, (err, foundUser) => {
            if (err) {
                res.status(422).json({error: 'No user was found.'});
                return next(err);
            }

            // If user is found, check role.
            if (helpers.getRole(foundUser.role) >= helpers.getRole(requiredRole)) {
                return next();
            }

            return res.status(401).json({error: 'You are not authorized to view this content.'});
        });
    };
};

//= =======================================
// Forgot Password Route
//= =======================================

router.post('/forgot-password', (req, res, next) => {
    const email = req.body.email;

    User.findOne({email}, (err, existingUser) => {
        // If user is not found, return error
        if (err || existingUser == null) {
            res.status(422).json({error: 'Your request could not be processed as entered. Please try again.'});
            return next(err);
        }
        // Generate a token with Crypto
        crypto.randomBytes(48, (err, buffer) => {
            const resetToken = buffer.toString('hex');
            if (err) {
                return next(err);
            }
            existingUser.resetPasswordToken = resetToken;
            existingUser.resetPasswordExpires = Date.now() + 3600000; // 1 hour

            existingUser.save((err) => {
                // If error in saving token, return it
                if (err) {
                    return next(err);
                }
                const message = {
                    subject: 'Reset Password',
                    text: `${'You are receiving this because you (or someone else) have requested the reset of the password for your account.\n\n' +
                    'Please click on the following link, or paste this into your browser to complete the process:\n\n' +
                    'http://'}${req.headers.host}/reset-password/${resetToken}\n\n` +
                    `If you did not request this, please ignore this email and your password will remain unchanged.\n`
                };
                // Otherwise, send user email via SendGrid
                sendGrid.sendEmail(existingUser.email, message);

                return res.status(200).json({message: 'Please check your email for the link to reset your password.'});
            });
        });
    });
});

//= =======================================
// Reset Password Route
//= =======================================

router.post('/reset-password/:token', (req, res, next) => {
    User.findOne({resetPasswordToken: req.params.token, resetPasswordExpires: {$gt: Date.now()}}, (err, resetUser) => {
        // If query returned no results, token expired or was invalid. Return error.
        if (!resetUser) {
            res.status(422).json({error: 'Your token has expired. Please attempt to reset your password again.'});
        }

        // Otherwise, save new password and clear resetToken from database
        resetUser.password = req.body.password;
        resetUser.resetPasswordToken = undefined;
        resetUser.resetPasswordExpires = undefined;

        resetUser.save((err) => {
            if (err) {
                return next(err);
            }

            // If password change saved successfully, alert user via email
            const message = {
                subject: 'Password Changed',
                text: 'You are receiving this email because you changed your password. \n\n' +
                'If you did not request this change, please contact us immediately.'
            };

            // Otherwise, send user email confirmation of password change via Mailgun
            sendGrid.sendEmail(resetUser.email, message);

            return res.status(200).json({message: 'Password changed successfully. Please login with your new password.'});
        });
    });
});
// router.use(requireAuth);
router.get('/protected', requireAuth, (req, res) => {
    res.send({content: 'The protected test route is functional!'});
});
router.get('/admins-only', roleAuthorization(constsnts.ROLE_ADMIN), (req, res) => {
    res.send({content: 'Admin dashboard is working.'});
});
