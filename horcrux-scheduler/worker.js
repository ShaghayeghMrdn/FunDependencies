    const setupDone = Date.now();
// workerId is set through the 'start' cmd sent from main
// The worker should include its workerId in all of its messages to main
let workerId = 0;

self.addEventListener('message', (event) => {
    const inputReceived = Date.now();
    console.log(`Worker received ${JSON.stringify(event.data)}`);
    if (event.data.cmd == 'start') {
        workerId = event.data.id;
        // send a message to main thread to confirm setup is done
        self.postMessage({'status': 'ready',
                          'id': workerId,
                          'setupDone': setupDone});
    } else if (event.data.cmd == 'execute') {
        const fnBody = event.data.fnBody;
        const fnArgs = event.data.fnArgs;
        if (fnBody === 'undefined' || fnArgs === 'undefined') {
            const errorMsg = 'Error: function body or args are undefined';
            console.error(errorMsg);
            // TODO: send errorMsg back to main
            return;
        }
        const funcStart = Date.now();
        // initialize window var in the worker's global scope
        self.window = event.data.window;
        console.log(`worker global scope: ${JSON.stringify(self.window)}`);
        const reconstructed = new Function(fnArgs, fnBody);
        reconstructed();
        const runtime = Date.now() - funcStart;
        self.postMessage({
            'status': 'executed',
            'id': workerId,
            'window': self.window,
            'runtime': runtime,
        });
    }
});