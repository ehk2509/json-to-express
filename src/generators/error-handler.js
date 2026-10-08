'use strict';

const {filePaths, js, payload, relativeRequire} = require('./utils');

module.exports = function errorHandlerSource(spec) {
  const validationBase = payload(spec.app.responses.validationError);
  const validationPayload = validationBase.endsWith('}') ? validationBase.slice(0, -1) + ', details: error.message}' : validationBase;
  const uniqueBase = payload(spec.app.responses.uniqueConstraint);
  const uniquePayload = uniqueBase.endsWith('}') ? uniqueBase.slice(0, -1) + ', fields: error.keyValue || error.meta && error.meta.target}' : uniqueBase;

  const targetErrors = spec.database.type === 'postgresql'
    ? [
      "  if (error && error.name === 'PrismaClientValidationError') return res.status(" + spec.app.statusCodes.validationError + ').json(' + validationPayload + ');',
      "  if (error && error.code === 'P2002') return res.status(" + spec.app.statusCodes.uniqueConstraint + ').json(' + uniquePayload + ');',
      "  if (error && error.code === 'P2003') return res.status(409).json({error: 'Relation constraint violated'});",
      "  if (error && error.code === 'P2025') return res.status(" + spec.app.statusCodes.notFound + ').json(' + payload(spec.app.responses.notFound) + ');'
    ]
    : [
      "  if (error && error.name === 'ValidationError') return res.status(" + spec.app.statusCodes.validationError + ').json(' + validationPayload + ');',
      "  if (error && error.name === 'CastError') return res.status(" + spec.app.statusCodes.invalidIdentifier + ').json(' + payload(spec.app.responses.invalidIdentifier) + ');',
      "  if (error && error.code === 11000) return res.status(" + spec.app.statusCodes.uniqueConstraint + ').json(' + uniquePayload + ');'
    ];

  const paths = filePaths(spec);
  return [
    "'use strict';", '',
    ...(spec.observability.enabled ? ['const observability = require(' + js(relativeRequire(paths.errorHandler, paths.observability)) + ');', ''] : []),
    'module.exports = function errorHandler(error, req, res, next) {',
    ...(spec.observability.enabled ? ['  observability.logger.error("http.request.error", {requestId: req.id, error: error && error.message, code: error && error.code});'] : []),
    ...targetErrors,
    "  if (error && error.statusCode) return res.status(error.statusCode).json({error: error.message});",
    ...(spec.observability.enabled
      ? ['  // Error already emitted through structured observability logging.']
      : ['  console.error(error);']),
    '  return res.status(' + spec.app.statusCodes.internalError + ').json(' + payload(spec.app.responses.internalError) + ');',
    '};', ''
  ].join('\n');
};
