var scope = require('./scopeAnalyzer.js');

var extractIdentifiers = function(node){
        /*
    The following read types are available for the assignment expression RHS:
    - Identifier
    - Literal (ignored)
    - CallExpression
    - Object Expression 
    - Logical Expression
    - Binary Expression
    - Unary expression
    - New expression
    - Array expression
    - Memberexpression
      Function Expression
      New Expression
      updateExpression

   */
    var readArray = [];

    var readRecursively = function(node){
        // console.log("checking for " + node.source() + "with type " + node.type)
        if (node == null || node.type == "Literal")
            return;
        if (node.type == "Identifier" || node.type == "ThisExpression") {
            readArray.push(node)
            return;
        } else if (node.type == "ObjectPattern") {
            node.properties.forEach((prop)=>{
                readRecursively(prop.key);
            })

        } else if (node.type == "UnaryExpression") {
                readRecursively(node.argument);
        } else if (node.type == "ConditionalExpression") {
            readRecursively(node.test);
            readRecursively(node.consequent);
            readRecursively(node.alternate);
        } else if (node.type == "ObjectExpression") {
            node.properties.forEach(function(elem){
                readRecursively(elem.value);
            });
            // readArray.push(node);
        } else if (node.type == "ArrayExpression") {
            node.elements.forEach(function (elem) {
                readRecursively(elem);
            });
            //Excluding call expression check here because it is already accounted for the in the main loop index.js
        } else if (/*node.type == "CallExpression" ||*/ node.type == "NewExpression") {
            node.arguments.forEach(function(arg){
                readRecursively(arg);
            });
            //WTF am I doing this?
        } /*else if (node.type == "FunctionExpression") {
            node.params.forEach(function(arg){
                readRecursively(arg);
            })
        } */ else if (node.type == "AssignmentExpression"){
            /* DOn't need to handle this case, as the right hand side assignment expression will handle it's own reads during the assignment expression node type callback*/
            // readArray = handleAssignmentExpressions(node);
        } else if (node.type == "SequenceExpression"){
            node.expressions.forEach(function(exp){
                readRecursively(exp);
            })
        }
    }

    readRecursively(node);
    return readArray; 
}

var isParamOfFunction = function(node){
    //Find the first parent of the type function expression or declaration
    // and test whether it is a param of that immediate function parent
    var parent = node;
    var isParam = false;
    while (parent != null && parent.type != "FunctionExpression" && parent.type != "FunctionDeclaration")
        parent = parent.parent;
    if (parent != null) {
        parent.params.forEach((param)=>{
            if (param == node)
                isParam = true;
        })
    }
    return isParam;
}
var handleReads = function(node, haveIds) {
    // console.log("handling for reads: " +  node.source() + " " + node.type);
    var readArray;
    if (haveIds)
        readArray = [node];
    else readArray = extractIdentifiers(node);
    if (readArray == null) return [];
    var globalReads = [];
    var argReads = [];
    var antiLocal = [];
    var localReads = [];
    readArray.forEach(function(read){
        var _isLocal = scope.IsLocalVariable(read)
        if (_isLocal == -3  )
            globalReads.push(read);
        else if (_isLocal >= 0 && !isParamOfFunction(read))
            argReads.push({ind:_isLocal,val:read});
        else if (_isLocal == -2)
            localReads.push(read);
        else
            antiLocal.push(read);
    });
    return {readArray: globalReads, local: localReads, argReads: argReads, antiLocal: antiLocal};
}

module.exports = {
    handleReads: handleReads,
    extractIdentifiers: extractIdentifiers
}