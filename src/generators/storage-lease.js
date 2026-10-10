'use strict';

const {filePaths, js, relativeRequire} = require('./utils');

module.exports = function storageLeaseSource(spec) {
  const path = filePaths(spec);
  if (spec.database.type === 'mongodb') return [
    "'use strict';", '',
    "const mongoose = require('mongoose');",
    'const schema = new mongoose.Schema({',
    '  _id: {type:String, required:true},',
    '  owner: {type:String, required:true},',
    '  generation: {type:Number, required:true, default:0},',
    '  expiresAt: {type:Date, required:true}',
    '}, {versionKey:false});',
    "const Lease = mongoose.models.J2EStorageLease || mongoose.model('J2EStorageLease', schema);",
    "const ID = 'global-storage-reconciliation';",
    'async function acquire(owner, ttlMs=60000) {',
    '  const now=new Date();',
    '  try {',
    '    const row=await Lease.findOneAndUpdate({',
    '      _id:ID, $or:[{expiresAt:{$lte:now}},{expiresAt:{$exists:false}}]',
    '    }, {$set:{owner,expiresAt:new Date(Date.now()+ttlMs)},$inc:{generation:1}},',
    '    {upsert:true,new:true});',
    '    return row ? {owner,generation:row.generation} : null;',
    '  } catch(error) {if(error.code===11000)return null;throw error;}',
    '}',
    'function selector(token) {return {_id:ID,owner:token.owner,generation:token.generation,expiresAt:{$gt:new Date()}};}',
    'async function valid(token) {return Boolean(token && await Lease.exists(selector(token)));}',
    'async function renew(token,ttlMs=60000) {',
    '  const result=await Lease.updateOne(selector(token),{$set:{expiresAt:new Date(Date.now()+ttlMs)}});',
    '  return result.modifiedCount===1;',
    '}',
    'async function release(token) {',
    '  if(!token)return;',
    '  await Lease.updateOne(selector(token),{$set:{expiresAt:new Date(0)}});',
    '}',
    'module.exports={acquire,valid,renew,release,Lease};', ''
  ].join('\n');
  return [
    "'use strict';", '',
    'const db=require('+js(relativeRequire(require('node:path').posix.join(spec.generation.paths.source,spec.generation.paths.config,'storage-lease.js'),path.database))+');',
    'const prisma=db.client;',
    "const ID = 'global-storage-reconciliation';",
    'async function acquire(owner,ttlMs=60000) {',
    '  const now=new Date();',
    '  const claimed=await prisma.j2EStorageLease.updateMany({where:{id:ID,expiresAt:{lte:now}},',
    '    data:{owner,expiresAt:new Date(Date.now()+ttlMs),generation:{increment:1}}});',
    '  if(claimed.count===1) {const row=await prisma.j2EStorageLease.findUnique({where:{id:ID}});',
    '    return row && row.owner===owner ? {owner,generation:row.generation} : null;}',
    '  try {',
    '    const row=await prisma.j2EStorageLease.create({data:{id:ID,owner,generation:1,expiresAt:new Date(Date.now()+ttlMs)}});',
    '    return {owner,generation:row.generation};',
    '  } catch(error) {if(error.code==="P2002")return null;throw error;}',
    '}',
    'function where(token) {return {id:ID,owner:token.owner,generation:token.generation,expiresAt:{gt:new Date()}};}',
    'async function valid(token) {return Boolean(token && await prisma.j2EStorageLease.count({where:where(token)}));}',
    'async function renew(token,ttlMs=60000) {',
    '  const result=await prisma.j2EStorageLease.updateMany({where:where(token),data:{expiresAt:new Date(Date.now()+ttlMs)}});',
    '  return result.count===1;',
    '}',
    'async function release(token) {if(token)await prisma.j2EStorageLease.updateMany({where:where(token),data:{expiresAt:new Date(0)}});}',
    'module.exports={acquire,valid,renew,release};',''
  ].join('\n');
};
