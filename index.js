var namedQueue = require('named-queue');
var helpers = require('./helpers')

var providers = {
    metadata: require('./providers/cinemeta'),
    imdbFind: require('./providers/imdbFind'),
}

var defaultProviders = ['metadata', 'imdbFind']

// Constants
var CACHE_TTL = 12*60*60*1000; // if we don't find an item, how long does it stay in the cache as 'not found' before we retry it 

// In-memory cache for matched items, to avoid flooding Google (or whatever search api we use)
var cache = { };
var cacheLastSet = { };

// Named queue, means that we're not working on one name more than once at a tim
// and a total of 3 names at once
var queue = new namedQueue(worker, 3)

// Outside API
function nameToImdb(args, cb) {
    args = typeof(args)=='string' ? { name: args } : args

    var q = { name: args.name }
    if (args.year) q.year = args.year
    if (args.type) q.type = args.type

    if (!q.name)
        return cb(new Error('empty name'))

    if (q.year && typeof(q.year)=='string') q.year = parseInt(q.year.split('-')[0])
    
    if (q.year && isNaN(q.year))
        return cb(new Error('invalid year'))

    if (q.type && !(q.type=='movie' || q.type=='series')) 
        return cb(null, null) // no match for other types

    var key = new Buffer(args.hintUrl || Object.values(q).join(':')).toString('ascii') // convert to ASCII since EventEmitter bugs with UTF8
    
    if (cache.hasOwnProperty(key) && Date.now()-cacheLastSet[key] < CACHE_TTL) {
        return cb(null, cache[key][0], { match: cache[key][1].match, isCached: true })
    }

    queue.push({ 
        id: key,
        q: q,
        providers: args.providers || defaultProviders,
    }, function(err, imdb_id, match) {
        if (err)
            return cb(err)
        
        if (imdb_id) {
            cache[key] = [imdb_id, match]
            cacheLastSet[key] = Date.now()
        }

        cb(null, imdb_id, match)
    })
};

function worker(task, cb) {
    var prov = [].concat(task.providers)

    nextProv()

    function nextProv()
    {
        var n = prov.shift()
        if (! n)
            return cb(null, null)

        var provider = providers[n]
        if (!provider)
            return cb(new Error('unknown provider: '+n))

        provider(task.q, function(err, id) {
            if (err)
                return cb(err)

            if (id)
                return cb(null, id, { match: n })
            else
                nextProv()
        })
    }
}

module.exports = nameToImdb;
