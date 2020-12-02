const webWorkerScriptID = '__horcrux_worker__';
const numOfWorkers = 1;

/**
 * defines the __callScheduler__ function globally which acts as wake up call.
 * sets up a number of workers, and adds them to the list of available workers.
 * TODO: initialize Horcrux special event queue
 */
function __defineScheduler__() {
    // List of all workers
    const workers = [];
    // List of available workers
    const availableWorkers = [];
    setUpWorkers();
    // Horcrux special event queue: holds functions in order to be executed
    const horcruxQueue = [];
    /** Map from closure def location to defined variables in that location.
        value is a dictionary of variable names to their corresponding values
     * @type{Object.<string, Object.<string, Object>>}
     */
    const closureMap = new Map();

    /** Wakes up the main scheduler to handle:
     * case 1: TODO
     * case 2: when a function wanted to be invoked inside <script>
     * -- This function is defined as a property of window so that
     * it can be called from inside rewritten IIFE and async functions.
     * @param {string} fnBody stringified function body, sent to constructor
     * @param {Array} fnSignature list of function dependencies
     */
    window.__callScheduler__ = function(fnBody, fnSignature) {
        // case 2: called from IIFE: offload a web worker if one is available
        if (availableWorkers.length > 0) {
            const workerInfo = availableWorkers.shift();
            offloadToWorker(workerInfo, fnBody, fnSignature);
        } else {
            horcruxQueue.push({'fnBody': fnBody, 'fnSignature': fnSignature});
        }
    };

    /** Helper function for JSON stringify when the value is a function
     * @param {string} key
     * @param {string} value
     * @return {string} stringified value
     */
    function functionStringifier(key, value) {
        if (typeof(value) === 'function') {
            return value.toString();
        }
        return value;
    }

    /** Helper function for JSON parse when the value is a function
     * @param {string} key
     * @param {string} value
     * @return {string} stringified functions is reconstructed as functions
     */
    function functionReviver(key, value) {
        if (typeof value === 'string') {
            const rfunc = /function[^\(]*\(([^\)]*)\)[^\{]*\{([\s\S]*)\}/;
            const match = value.match(rfunc);
            if (match) {
                const args = match[1].split(',').map(function(arg) {
                    return arg.replace(/\s+/, '');
                });
                return new Function(args, match[2]);
            }
        }
        return value;
    }

    /** Offloads a function to a web worker using postMessage
     * @param {Object} worker wrapper around actual worker object
     * @param {string} fnBody stringified function body to be offloaded
     * @param {Array} fnSignature list of function dependencies
     */
    function offloadToWorker(worker, fnBody, fnSignature) {
        const fnArgs = [];
        const windowClone = {};
        const inputValues = [];
        /** a dictionary of closure definition location to closure variables
         * defined in that location and updated in the worker
         * @type{Object.<string, string[]>}
         */
        const outputValues = {};
        // prepare the input arguments for the fnBody using the signature
        fnSignature.forEach((dependency) => {
            const scopeAccess = dependency[0].split('_');
            const name = dependency[1].substring(4); // removes ';;;;'
            if (scopeAccess[0] == 'global') {
                handleGlobalDependency(scopeAccess[1], name);
            } else if (scopeAccess[0] == 'closure') {
                console.assert(scopeAccess.length == 3, 'Expected length = 3');
                const access = scopeAccess[2]; // "reads" or "writes"
                const value = (access == 'reads') ? dependency[2] : '';
                handleClosureDependency(scopeAccess[1], access, name, value);
            } else {
                console.log('Besides global and cloure:', dependency);
            }
        });
        worker.assignedDependencies = fnSignature;
        worker.executing = true;
        worker.workerObj.postMessage({
            'cmd': 'execute',
            'fnBody': fnBody,
            'fnArgs': fnArgs.toString(),
            'window': JSON.stringify(windowClone, functionStringifier),
            'inputValues': inputValues,
            'outputValues': outputValues,
        });

        /* private helper functions for handling dependencies */
        /**
         * @param {string} access 'reads' or 'writes'
         * @param {string} name global variable name without window.
         */
        function handleGlobalDependency(access, name) {
            // for cases where window.name is accessed (read or write)
            // if window.name is undefined, it will not be passed to worker
            windowClone[name] = window[name];
        };

        /** Preparing closure dependencies to be passed to worker
         * @param {string} location of surrounding function that defines closure
         * @param {string} access 'reads' or 'writes'
         * @param {string} name closure variable name (might be path)
         * @param {string} value of the closure variable that is read
         */
        function handleClosureDependency(location, access, name, value) {
            if (access == 'reads') {
                // console.log(`reads closure ${name} = ${value}`);
                const nameParts = name.split(';;;;');
                if (nameParts.length == 1) {
                    const valueParts = value.split(';;&;;');
                    if (valueParts[1] == 'object' &&
                        valueParts[3] == 'Object') {
                        inputValues[name] = JSON.parse(valueParts[0]);
                        if (!closureMap.has(location)) {
                            closureMap.set(location, {name: inputValues[name]});
                        } else {
                            // just double-checking the values in closureMap
                            const old = closureMap.get(location);
                            console.log(old[name], 'vs', inputValues[name]);
                        }
                    }
                }
            } else if (access == 'writes') {
                if (outputValues[location] === undefined) {
                    outputValues[location] = [];
                }
                outputValues[location].push(name);
            }
        };
    };

    /** Takes care of applying the worker updates/outputs to the main
     * @param {Object} workerWindow updated window in worker scope
     * @param {Object.<string, Object>} updatedClosures dictionary from
     * closure definition location to the updated closure variables
     */
    function applyWorkerUpdates(workerWindow, updatedClosures) {
        for (const name in workerWindow) {
            if (workerWindow[name] !== 'undefined') {
                window[name] = workerWindow[name];
            }
        }
        for (const location in updatedClosures) {
            if (closureMap.has(location)) {
                // TODO: should not set the whole object
                // if parts of object is sent from worker only those fields
                // need to be updated here
                closureMap.get(location);
                closureMap.set(location, updatedClosures[location]);
            }
        }
        for (const [key, value] of closureMap.entries()) {
            console.log(`closureMap: ${key} = ${JSON.stringify(value)}`);
        }
    };

    /** Main thread 'message' event handler.
     * @param {MessageEvent} event Received message from worker in event.data
     */
    function mainThreadListener(event) {
        console.log(`Main received: ${JSON.stringify(event.data)}`);
        const workerId = event.data.id;
        if (workerId === 'undefined' || workerId >= numOfWorkers) {
            console.error('Error: web worker message does not indicate the id');
            return;
        }
        const worker = workers[workerId];
        if (event.data.status == 'ready') {
            const setupTime = event.data.setupDone - worker.setupStart;
            // console.log(`worker #${worker.id} setup time: ${setupTime}`);
            availableWorkers.push(worker);
        } else if (event.data.status == 'executed') {
            // console.log(`worker #${workerId}: runtime=${event.data.runtime}`);
            const workerWindow = JSON.parse(event.data.window, functionReviver);
            applyWorkerUpdates(workerWindow, event.data.updated);
            // free up the worker and add it to available workers
            worker.assignedDependencies = null;
            worker.executing = false;
            availableWorkers.push(worker);
        }
        // TODO: tof mali ro dorost konam
        if (horcruxQueue.length > 0) {
            const head = horcruxQueue.shift();
            offloadToWorker(worker, head.fnBody, head.fnSignature);
        }
    }

    /**
     * Sets up numOfWorkers of workers using with the content of <script>
     * identified by webWorkerScriptID.
     * @param {int} workerId
     */
    function setUpWorkers() {
        for (let workerId = 0; workerId < numOfWorkers; ++workerId) {
            const start = Date.now();
            const blob = new Blob([
                document.getElementById(webWorkerScriptID).textContent,
            ], {
                type: 'text/javascript',
            });
            const worker = new Worker(window.URL.createObjectURL(blob));
            worker.addEventListener('message', mainThreadListener);
            const workerInfo = {
                id: workerId,
                workerObj: worker,
                setupStart: start,
                executing: false,
                assignedDependencies: null,
            };
            /* This message is not necessary to start the web worker, it
             has already started, but more importantly it tells the web worker
             its id. */
            worker.postMessage({'cmd': 'start', 'id': workerId});
            workers.push(workerInfo);
        }
    };
};

if (typeof __scheduler__ === 'undefined') {
    __scheduler__ = new __defineScheduler__();
}


//  LocalWords:  workerId workerInfo postMessage closureMap updatedClosures
