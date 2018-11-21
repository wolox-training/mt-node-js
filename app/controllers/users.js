const users = require('../models').users;
const bcrypt = require('bcryptjs');
const errors = require('../errors');
const userServices = require('../services/users');
const logger = require('../logger');
const jwt = require('jwt-simple');
const tokenManager = require('../services/tokenManager');

const SALT = 10; // to ensure security
const MIN_PASSWORD_LENGTH = 8;
const LIMIT_DEFAULT = 50;
const PAGE_DEFAULT = 1;

const ADMIN_ROLE = 'admin';
const REGULAR_ROLE = 'regular';

const KEY = 'secret';

// Regex for Email domain validation
const ARGENTINA_WOLOX_DOMAIN = new RegExp('@wolox.com.ar');
const COLOMBIA_WOLOX_DOMAIN = new RegExp('@wolox.co');
const CHILE_WOLOX_DOMAIN = new RegExp('@wolox.cl');

const hasNoEmptyFields = user => user.email && user.password && user.firstName && user.lastName;

const hasValidDomain = email =>
  ARGENTINA_WOLOX_DOMAIN.test(email) || COLOMBIA_WOLOX_DOMAIN.test(email) || CHILE_WOLOX_DOMAIN.test(email);

const hasValidPassword = password => password.length >= MIN_PASSWORD_LENGTH;

const hasValidFields = user =>
  new Promise((resolve, reject) => {
    if (!hasNoEmptyFields(user)) {
      reject(errors.missingUserInformation());
    }

    if (!hasValidPassword(user.password)) {
      reject(errors.invalidPasswordFormat());
    }

    if (!hasValidDomain(user.email)) {
      reject(errors.invalidEmailDomain());
    }

    resolve();
  });

const hasUniqueEmail = email =>
  users.findUserByEmail(email).then(
    foundUser =>
      new Promise((resolve, reject) => {
        if (!foundUser) resolve();
        logger.error(errors.EMAIL_ALREADY_USED);
        reject(errors.emailAlreadyUsed());
      })
  );

const encryptPassword = password =>
  bcrypt.hash(password, SALT).catch(err => {
    logger.error(err);
    throw errors.defaultError(err);
  });

exports.signUp = (req, res, next) => {
  const user = req.body;
  user.role = user.role || REGULAR_ROLE;

  hasValidFields(user)
    .then(() => hasUniqueEmail(user.email))
    .then(() => encryptPassword(user.password))
    .then(hash => {
      user.password = hash;
      return users.addUser(user);
    })
    .then(() =>
      res.status(200).send({
        message: 'User created'
      })
    )
    .catch(next);
};

exports.signIn = (req, res, next) => {
  const user = req.body;

  if (!hasValidDomain(user.email)) return next(errors.invalidCredentials());

  users
    .findUserByEmail(user.email)
    .then(foundUser => {
      if (foundUser) {
        user.role = foundUser.role;
        return bcrypt.compare(user.password, foundUser.password);
      }
      return next(errors.invalidCredentials());
    })
    .then(valid => {
      if (!valid) return next(errors.invalidCredentials());
      const token = tokenManager.createToken(user);
      res.status(200).send({ token });
    })
    .catch(next);
};

const sendAllUsers = (res, allUsers) => {
  const usersAmount = allUsers.length;
  const response = {
    usersAmount,
    allUsers
  };
  res.status(200).send(response);
};

exports.listUsers = (req, res, next) => {
  const authenticationHeader = req.headers.authorization;
  const limit = req.query.limit || LIMIT_DEFAULT;
  const page = req.query.page || PAGE_DEFAULT;

  if (!authenticationHeader) return next(errors.authenticationFailure());

  users
    .getAllUsers(page, limit)
    .then(allUsers => sendAllUsers(res, allUsers))
    .catch(next);
};

const validatePermission = token =>
  new Promise((resolve, reject) => {
    if (!token) reject(errors.authenticationFailure());
    const decodedToken = tokenManager.decodeToken(token);
    console.log(decodedToken);
    if (decodedToken.role !== ADMIN_ROLE) reject(errors.noAccessPermission());
    resolve(token);
  });

// Only an admin can add another admin
exports.addAdmin = (req, res, next) => {
  const authenticationHeader = req.headers.authorization;
  const user = req.body;
  console.log(authenticationHeader);
  validatePermission(authenticationHeader)
    .then(() => hasValidFields(user))
    .then(() => users.findUserByEmail(user.email))
    .then(foundUser => {
      if (foundUser) {
        bcrypt.compare(user.password, foundUser.password, (err, result) => {
          if (err) throw errors.invalidCredentials();
        });
        foundUser.updateAttributes({
          role: ADMIN_ROLE
        });
        res.status(200).send(foundUser);
      } else {
        encryptPassword(user.password).then(hash => {
          user.password = hash;
          user.role = ADMIN_ROLE;
          users.addUser(user);
          res.status(200).send(user);
        });
      }
    })
    .catch(next);
};
