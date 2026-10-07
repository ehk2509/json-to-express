'use strict';

const {payload} = require('./utils');

module.exports = function errorHandlerSource(spec) {
  const validationBase = payload(spec.app.responses.validationError);
  const validationPayload = validationBase.endsWith('}') ? validationBase.slice(0, -1) + ', details: error.message}' : validationBase;
  const uniqueBase = payload(spec.app.responses.uniqueConstraint);
  const uniquePayload = uniqueBase.endsWith('}') ? uniqueBase.slice(0, -1) + ', fields: error.keyValue}' : uniqueBase;

  return [
    "'use strict';", '',
    'module.exports = function errorHandler(error, req, res, next) {',
    "  if (error && error.name === 'ValidationError') return res.status(" + spec.app.statusCodes.validationError + ').json(' + validationPayload + ');',
    "  if (error && error.name === 'CastError') return res.status(" + spec.app.statusCodes.invalidIdentifier + ').json(' + payload(spec.app.responses.invalidIdentifier) + ');',
    "  if (error && error.code === 11000) return res.status(" + spec.app.statusCodes.uniqueConstraint + ').json(' + uniquePayload + ');',
    "  if (error && error.statusCode) return res.status(error.statusCode).json({error: error.message});",
    '  console.error(error);',
    '  return res.status(' + spec.app.statusCodes.internalError + ').json(' + payload(spec.app.responses.internalError) + ');',
    '};', ''
  ].join('\n');
};
