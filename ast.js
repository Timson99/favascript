const fs = require('fs');
const ohm = require('ohm-js');
const grammarContents = fs.readFileSync('favascript.ohm');
const grammar = ohm.grammar(grammarContents);
const Context = require('./semantics/context');

const spacer = "  ";

const TYPE = {
    BOOLEAN: "BOOLEAN",
    INTEGER: "INTEGER",
    FLOAT: "FLOAT",
    STRING: "STRING",
    LIST: "LIST",
    DICTIONARY: "DICTIONARY",
    TUPLE: "TUPLE",
    FUNCTION: "FUNCTION",
    CLASS: "CLASS",
    NULL: "NULL",
    OBJECT: "OBJECT"
}

function defineTypePairs() {
    allTypePairs = [];
    for (let i in TYPE) {
        if (TYPE.hasOwnProperty(i)) {
            for (let j in TYPE) {
                if (TYPE.hasOwnProperty(j)) {
                    allTypePairs.push([i, j]);
                }
            }
        }
    }
}
defineTypePairs();

function canBeA(receivedType, dominantType) {
    const FLOAT_ACCEPT = [
        TYPE.FLOAT,
        TYPE.INTEGER
    ]
    // TODO: undefined?
    if (dominantType === TYPE.FLOAT) {
        return FLOAT_ACCEPT.indexOf(receivedType) > -1;
    } else {
        return receivedType === dominantType;
    }
}

function canArgumentsFitParameters(args, params) {
    return (args.length == params.length) && args.every(function(element, index) {
        return canBeA(element, params[index]);
    });
}

function getValue(obj) {
    if (typeof obj === "undefined") {
        return "undefined";
    } else if (obj.hasOwnProperty("value") && (typeof obj["value"] !== "undefined")) {
        return obj.value;
    } else {
        for (var prop in obj) {
            if (obj.hasOwnProperty(prop)) {
                getValue(obj["prop"]);
            }
        }
    }
}

function getType(obj) {
    if (typeof obj === "undefined") {
        return "undefined";
    } else if (obj.hasOwnProperty("type") && (typeof obj["type"] !== "undefined")) {
        return obj.type;
    } else {
        for (var prop in obj) {
            if (obj.hasOwnProperty(prop)) {
                getValue(obj["prop"]);
            }
        }
    }
}

function getIdExp(variable) {
    if (variable.hasOwnProperty("var")) {
        if (variable["var"] instanceof IdExpression) {
            return variable["var"];
        } else {
            return getIdExp(variable["var"]);
        }
    }
}

function getVar(variable) {
    if (variable.hasOwnProperty("var")) {
        return variable["var"];
    } else {
        console.log("***************VARIABLE: ", variable);
        for (let a in variable) {
            if (variable.hasOwnProperty(a)) {
                console.log("***************PROPERTY: ", a);
                return getVar(a);
            }
        }
        console.log("fuck you");
        return "undefined";
    }
}

class Program {
    constructor(block) {
        this.block = block;
    }
    analyze(context = new Context()) {

        // Don't use createChildContextForBlock since we don't want an extra level.
        // context.parent should equal null.
        this.block.analyze(context);
    }
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(Program` +
               `\n${this.block.toString(++indent)}` +
               `\n${spacer.repeat(--indent)})`;
    }
    optimize() {
        this.block = this.block.optimize();
        return this.toString();
    }
}

class Block {
    constructor(body) {
        this.body = body;
        this.returnType;
        this.numberOfReturnStatements = 0;
    }
    analyze(context) {
        let self = this;
        this.body.forEach(function(statement) {
            statement.analyze(context);
            if (statement.constructor === ReturnStatement) {
                self.numberOfReturnStatements++;
                if (self.numberOfReturnStatements <= 1) {
                    self.returnType = statement.returnType;
                } else {
                    context.throwMultipleReturnsInABlockError();
                }
            }
        });
    }
    toString(indent = 0) {
        var string = `${spacer.repeat(indent++)}(Block`;
        for (var statementIndex in this.body) {
            string += `\n${this.body[statementIndex].toString(indent)}`;
        }
        string += `\n${spacer.repeat(--indent)})`;
        return string;
    }
    optimize() {
        let newBody = [];
        for (let s in this.body) {
            let st = this.body[s];
            if (st instanceof ReturnStatement) {
                st = st.optimize();
                newBody.push(st);
                return new Block(newBody);
            } else {
                this.body[s] = st.optimize();
                newBody.push(st);
            }
        }
        this.body.filter(s => s !== null);
        return this;
    }
}

class Statement {
}

// Use this for both conditional and if/else statement
class BranchStatement extends Statement {
    constructor(conditions, thenBlocks, elseBlock) {
        super();
        this.conditions = conditions;
        this.thenBlocks = thenBlocks;
        this.elseBlock = elseBlock;
        this.context;
    }
    analyze(context) {
        this.conditions.forEach(function(condition) {
            condition.analyze(context);
            context.assertIsTypeBoolean(condition.returnType ? condition.returnType : condition.type);
        });
        this.thenBlocks.forEach(block => block.analyze(context.createChildContextForBlock()));
        if (this.elseBlock !== null) {
            this.elseBlock.analyze(context.createChildContextForBlock());
        }
        this.context = context;
    }
    toString(indent = 0) {
        var string = `${spacer.repeat(indent++)}(If`;
        for (var i in this.conditions) {
            string += `\n${spacer.repeat(indent)}(Case` +
                      `\n${spacer.repeat(++indent)}(Condition` +
                      `\n${this.conditions[i].toString(++indent)}` +
                      `\n${spacer.repeat(--indent)})` +
                      `\n${spacer.repeat(indent)}(Body` +
                      `\n${this.thenBlocks[i].toString(++indent)}` +
                      `\n${spacer.repeat(--indent)})` +
                      `\n${spacer.repeat(--indent)})`;
        }
        if (typeof this.elseBlock !== "undefined" && this.elseBlock !== null) {
            string += `\n${spacer.repeat(indent)}(Else` +
                      `\n${this.elseBlock.toString(++indent)}` +
                      `\n${spacer.repeat(--indent)})`;
        }
        string += `\n${spacer.repeat(--indent)})`;
        return string;
    }
    optimize() {
        let newConditions = [];
        let newThens = [];

        for (let t in this.thenBlocks) {
            this.thenBlocks[t] = this.thenBlocks[t].optimize();
        }

        for (let c in this.conditions) {
            let cond = this.conditions[c];
            cond = cond.optimize();
            cond.analyze(this.context);
            if (getValue(cond) === "true") {
                newConditions.push(cond);
                newThens.push(this.thenBlocks[c]);
                return new BranchStatement(newConditions, newThens);
            } else if (getValue(cond) === "false") {
                continue;
            }
            newConditions.push(cond);
            newThens.push(this.thenBlocks[c]);
        }
        this.conditions.filter(c => c !== null);
        this.thenBlocks.filter(t => t !== null);
        this.elseBlock = this.elseBlock.optimize();
        return this;
    }
}

class FunctionDeclarationStatement extends Statement {
    constructor(id, parameterArray, block) {
        super();
        this.id = id;
        this.parameterArray = parameterArray;
        this.block = block;
        this.isConstructor;
        this.ownerClass;
    }
    analyze(context) {
        this.ownerClass = context.currentClass;
        let blockContext = context.createChildContextForFunction(this.id, this.isConstructor);
        try {
            blockContext.assertFunctionIsConstructor("This is not a constructor");
            this.isConstructor = true;
        } catch(err) {
            this.isConstructor = false;
        }
        let self = this;
        this.parameterArray.forEach(function(parameter) {
            parameter.analyze(context);
            if (parameter.defaultValue !== null) {
                blockContext.setVariable(parameter.id, {type: parameter.defaultValue.type});
            } else {
                blockContext.addUndeclaredParameter(parameter.id);
            }
        });
        this.block.analyze(blockContext);
        let signature = [];
        this.parameterArray.forEach(function(parameter) {
            let entry = blockContext.get(
                parameter.id,
                true,  // silent = true
                true  // onlyThisContext = true
            );
            if (!entry && !blockContext.isParameterUsedInBody(parameter.id)) {
                context.declareUnusedLocalVariable(parameter.id);
            } else if (entry && blockContext.isParameterUsedInBody(parameter.id)) {
                blockContext.removeParameterUsedInBody(parameter.id);
                signature.push(blockContext.get(parameter.id).type);
            } else if (!blockContext.isParameterUsedInBody(parameter.id)) {
                signature.push(blockContext.get(parameter.id).type);
            }
        });

        context.setVariable(this.id, {type: TYPE.FUNCTION, returnType: this.block.returnType, parameters: signature});
    }
    toString(indent = 0) {
        var string = `${spacer.repeat(indent)}(Func` +
                    `\n${spacer.repeat(++indent)}(id ${this.id})` +
                    `\n${spacer.repeat(indent++)}(Parameters`;
        if (this.parameterArray.length !== 0) {
            for (var parameterIndex in this.parameterArray) {
                string += `\n${this.parameterArray[parameterIndex].toString(indent)}`;
            }
            string += `\n${spacer.repeat(--indent)})`;
        } else {
          string += `)`;
          indent -= 1;
        }
        string += `\n${this.block.toString(indent)}` +
                  `\n${spacer.repeat(--indent)})`;
        return string;
    }
    optimize() {
        this.parameterArray.forEach(p => p.optimize());
        this.parameterArray.filter(p => p !== null);
        this.block = this.block.optimize();
        return this;
    }
}

class Parameter {
    constructor(id, defaultValue) {
        this.id = id;
        this.defaultValue = defaultValue;
        this.type;
    }
    analyze(context) {
        if (this.defaultValue) {
            this.defaultValue.analyze(context);
            let entry = context.get(this.defaultValue, true);
            this.type = this.defaultValue.type;
        } else {
            let entry = context.get(this.id, true);
            this.type = "undefined";
        }
    }
    toString(indent = 0) {
        var string = `${spacer.repeat(indent)}(id ${this.id}`;
        if(this.defaultValue !== null) {
            string += `, default ${this.defaultValue}`;
        }
        string += `)`
        return string
    }
    optimize() {
        if (this.defaultValue !== null) {
            this.defaultValue = this.defaultValue.optimize();
        }
        return this;
    }
}

class ClassDeclarationStatement extends Statement {
    constructor(id, block) {
        super();
        this.id = id;
        this.block = block;
    }
    analyze(context) {
        let classContext = context.createChildContextForClass(this.id);
        classContext.setVariable("this", {type: TYPE.OBJECT});
        this.block.analyze(classContext);
        let constructorFunction = classContext.get(this.id);
        if (constructorFunction == "undefined") {
            context.throwNoClassConstructorError(this.id);
        } else {
            context.setVariable(this.id, {type: TYPE.FUNCTION, returnType: TYPE.OBJECT, parameters: constructorFunction.parameters});
        }
    }
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(Class` +
               `\n${spacer.repeat(++indent)}(id ${this.id})` +
               `\n${this.block.toString(indent)}` +
               `\n${spacer.repeat(--indent)})`;
    }
    optimize() {
        this.block = this.block.optimize();
        return this;
    }
}

class MatchStatement extends Statement {
    constructor(matchExp) {
        super();
        this.matchExp = matchExp;
    }
    analyze(context) {
        this.matchExp.analyze(context);
    }
    toString(indent = 0) {
        return `${this.matchExp.toString(indent)}`;
    }
    optimize() {
        this.matchExp = this.matchExp.optimize();
        return this;
    }
}

class WhileStatement extends Statement {
    constructor(exp, block) {
        super();
        this.exp = exp;
        this.block = block;
    }
    analyze(context) {
        this.exp.analyze(context);
        context.assertIsTypeBoolean(this.exp.returnType? this.exp.returnType : this.exp.type);
        this.block.analyze(context.createChildContextForBlock());
    }
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(While` +
          `\n${spacer.repeat(++indent)}(Condition` +
               `\n${this.exp.toString(++indent)}` +
               `\n${spacer.repeat(--indent)})` +
               `\n${spacer.repeat(indent)}(Body` +
               `\n${this.block.toString(++indent)}` +
               `\n${spacer.repeat(--indent)})` +
               `\n${spacer.repeat(--indent)})`;
    }
    optimize() {
        this.exp = this.exp.optimize();
        this.block = this.block.optimize();
        return this;
    }
}

class ForInStatement extends Statement {
    constructor(id, idExp, block) {
        super();
        this.id = id;
        this.idExp = idExp;
        this.block = block;
    }
    analyze(context) {
        this.idExp.analyze(context);
        let blockContext = context.createChildContextForBlock();
        blockContext.setVariable(this.id, {type: this.idExp.returnType});
        this.block.analyze(blockContext);
    }
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(For id (${this.id}) in` +
               `\n${this.idExp.toString(++indent)}` +
               `\n${this.block.toString(indent)}` +
               `\n${spacer.repeat(--indent)})`;
    }
    optimize() {
        this.idExp = this.idExp.optimize();
        this.block = this.block.optimize();
        return this;
    }
}

class PrintStatement extends Statement {
    constructor(exp) {
        super();
        this.exp = exp;
    }
    analyze(context) {
        this.exp.analyze(context);
    }
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(Print` +
               `\n${this.exp.toString(++indent)}` +
               `\n${spacer.repeat(--indent)})`;
    }
    optimize() {
        this.exp = this.exp.optimize();
        return this;
    }
}

class AssignmentStatement extends Statement {
    constructor(idExp, assignOp, exp) {
        super();
        this.idExp = idExp;
        this.assignOp = assignOp;
        this.exp = exp;
        this.isConstant;
        this.context;
    }
    analyze(context) {

        this.idExp.analyze(context, true);  // Will have id and type
        this.exp.analyze(context);


        let entry = context.get(this.exp.id);
        if (!entry) {
            context.addParameterUsedInBody(this.exp.id);
        }
        this.isConstant = this.idExp.idExpBody.idExpBase instanceof ConstId ? true : false;


        if (this.assignOp == "=") {
            if (this.idExp.id !== "this") {
                context.setVariable(this.idExp.id, {type: this.exp.type, value: this.exp.value});
            }
        } else {
            let expectedPairs = [
                [TYPE.INTEGER, TYPE. INTEGER],
                [TYPE.INTEGER, TYPE.FLOAT],
                [TYPE.FLOAT, TYPE.INTEGER],
                [TYPE.FLOAT, TYPE.FLOAT],
            ];
            let inferredType = TYPE.FLOAT;

            if (this.idExp.type === "undefined") {
                this.idExp.enforceType(inferredType, context);
            }

            if (this.exp.type === "undefined") {
                this.exp.enforceType(inferredType, context);
            }

            context.assertBinaryOperandIsOneOfTypePairs(
                this.assignOp,
                expectedPairs,
                [this.idExp.type, this.exp.type]
            );
        }
        this.context = context;
    }
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(${this.assignOp}` +
               `\n${this.idExp.toString(++indent)}` +
               `\n${this.exp.toString(indent)}` +
               `\n${spacer.repeat(--indent)})`;
    }
    optimize() {
        let resetVariable = (variable, value) => {
            let entry = this.context.get(variable);
            entry["value"] = value;
            this.context.setVariable(variable, entry);
            let target = this.idExp.idExpBody;
            while (target instanceof IdExpressionBodyRecursive) {
                target = target.idExpBody;
            }
            target.idExpBase.value = value;
        }
        this.idExp = this.idExp.optimize();
        this.exp = this.exp.optimize();
        this.analyze(this.context);
        resetVariable(this.idExp.id, this.exp.value);
        this.analyze(this.context);
        return this;
    }
}

class IdentifierStatement extends Statement {
    constructor(idExp) {
        super();
        this.idExp = idExp;
    }
    analyze(context) {
        this.idExp.analyze(context);
    }
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(Identifier Statement` +
              `\n${this.idExp.toString(++indent)}` +
              `\n${spacer.repeat(--indent)})`;
    }
    optimize() {
        this.idExp = this.idExp.optimize();
        return this;
    }
}

class ReturnStatement extends Statement {
    constructor(exp) {
        super();
        this.exp = exp;
        this.returnType;
    }
    analyze(context) {
        context.assertReturnInFunction();
        this.exp.analyze(context);
        try {
            let id = this.exp.id
            if (context.isUndeclaredParameter(id)) {
                context.removeUndeclaredParameter(id);
                context.setVariable(id, TYPE.NULL);
            }
        } catch(err) {}
        this.returnType = this.exp.type;
    }
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(Return` +
               `\n${this.exp.toString(++indent)}` +
               `\n${spacer.repeat(--indent)})`;
    }
    optimize() {
        this.exp = this.exp.optimize();
        return this;
    }
}

class Expression {
}

util = require('util');

class MatchExpression extends Expression {
    constructor(idExp, varArray, matchArray, matchFinal) {
        super();
        this.idExp = idExp;
        this.varArray = varArray;
        this.matchArray = matchArray;
        this.matchFinal = matchFinal[0];
    }
    analyze(context) {
        this.idExp.analyze(context);
        for (let v in this.varArray) {
            this.varArray[v].analyze(context);
            context.assertIsValidMatchVariable(this.idExp.type, this.varArray[v].type);
        }
        for (let m in this.matchArray) {
            this.matchArray[m].analyze(context);
        }
    }
    toString(indent = 0) {
        var string = `${spacer.repeat(indent)}(Match Expression` +
                     `\n${this.idExp.toString(++indent)}` +
                     `\n${spacer.repeat(indent++)}(Matches`;
        if (this.varArray.length != 0 && this.varArray.length == this.matchArray.length) {
            for (var varIndex in this.varArray) {
                string += `\n${spacer.repeat(indent)}(Match` +
                          `\n${this.varArray[varIndex].toString(++indent)} ->` +
                          `\n${this.matchArray[varIndex].toString(indent)}` +
                          `\n${spacer.repeat(--indent)})`
            }
        }
        if (this.matchFinal !== "undefined" && this.matchFinal !== undefined) {
          string += `\n${spacer.repeat(indent)}(Match` +
                    `\n${spacer.repeat(++indent)}_ ->` +
                    `\n${this.matchFinal.toString(indent)}` +
                    `\n${spacer.repeat(--indent)})`;
        }
        string += `\n${spacer.repeat(--indent)})` +
                  `\n${spacer.repeat(--indent)})`;
        return string;
    }
    optimize() {
        this.idExp = this.idExp.optimize();
        this.varArray.forEach(v => v.optimize());
        this.varArray.filter(v => v !== null);
        this.matchArray.forEach(m => m.optimize());
        this.matchArray.filter(m => m !== null);
        if (typeof this.matchFinal !== "undefined") {
            this.matchFinal = this.matchFinal.optimize();
        }
        return this;
    }
}

class Match {
    constructor(matchee) {
        this.matchee = matchee;
    }
    analyze(context) {
        this.matchee.analyze(context);
    }
    toString(indent = 0) {
        return `${this.matchee.toString(indent)}`;
    }
    optimize() {
        this.matchee = this.matchee.optimize();
        return this;
    }
}

class BinaryExpression extends Expression {
    constructor(left, op, right) {
        super();
        this.left = left;
        this.op = op;
        this.right = right;
        this.type;
        this.context; // IS THIS OK TOAL?
    }
    analyze(context) {

        let expectedPairs;
        let inferredType;

        if (this.op == "||" || this.op == "&&") {
            expectedPairs = [[TYPE.BOOLEAN, TYPE.BOOLEAN]];
            inferredType = TYPE.BOOLEAN;
        } else if (["+", "-", "/", "*", "<=", "<", ">=", ">", "^"].indexOf(this.op) > -1) {
            expectedPairs = [
                [TYPE.INTEGER, TYPE.INTEGER],
                [TYPE.INTEGER, TYPE.FLOAT],
                [TYPE.FLOAT, TYPE.INTEGER],
                [TYPE.FLOAT, TYPE.FLOAT]
            ];
            inferredType = TYPE.FLOAT;
        } else if (this.op == "//" || this.op == "%") {
            expectedPairs = [
                [TYPE.INTEGER, TYPE.INTEGER],
                [TYPE.FLOAT, TYPE.INTEGER]
            ];
            inferredType = TYPE.INTEGER;
        } else if (this.op == "==" || this.op == "!=") {
            expectedPairs = allTypePairs;
        }

        this.left.analyze(context);
        this.right.analyze(context);

        if (this.left.type === "undefined") {
            this.left.enforceType(inferredType, context);
        }

        if (this.right.type === "undefined") {
            this.right.enforceType(inferredType, context);
        }

        // TODO: What if inferredType is undefined, like when op = "==" or "!="?

        // canBeA(this.operand.type, inferredType)

        context.assertBinaryOperandIsOneOfTypePairs(
            this.op,
            expectedPairs,
            [this.left.type, this.right.type]
        );

        // Should we be taking this.left.type or inferredType?
        this.type = ["<=", "<", ">=", ">"].indexOf(this.op) > -1 ? TYPE.BOOLEAN : this.left.type;
        this.context = context;
    }
    enforceType(type, context) {
        if (this.left.type == "undefined") {
            this.left.enforceType(type, context);
        }
        if (!canBeA(this.left.type, type)) {
            context.throwCantResolveTypesError(this.left.type, type);
        }
        if (this.right.type == "undefined") {
            this.right.enforceType(type, context);
        }
        if (!canBeA(this.right.type, type)) {
            context.throwCantResolveTypesError(this.right.type, type);
        }
    }
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(${this.op}` +
               `\n${this.left.toString(++indent)}` +
               `\n${this.right.toString(indent)}` +
               `\n${spacer.repeat(--indent)})`;
    }
    optimize() {
        this.left = this.left.optimize();
        this.right = this.right.optimize();
        this.left.analyze(this.context);
        this.right.analyze(this.context);
        let leftFloat = parseFloat(getValue(this.left));
        let rightFloat = parseFloat(getValue(this.right));

        let returnNumber = (type, value) => {
            if (type == TYPE.INTEGER) {
                return new IntLit(value);
            } else if (type == TYPE.FLOAT) {
                return new FloatLit(value);
            }
        }

        // let getIdExp = (variable) => {
        //     if (variable.hasOwnProperty("var")) {
        //         if (variable["var"] instanceof IdExpression) {
        //             return variable["var"];
        //         } else {
        //             return getIdExp(variable["var"]);
        //         }
        //     }
        // }

        // Strength Reduction
        if (typeof getValue(this.left) === "undefined" ||
            typeof getValue(this.right) === "undefined") {
                if (this.op == "+") {
                    if (leftFloat == 0) {
                        return this.right;
                    } else if (rightFloat == 0) {
                        return this.left;
                    } else if (this.left instanceof UnaryExpression && this.left.op == "-") {
                        return new BinaryExpression(this.right, "-", this.left.operand);
                    } else if (this.right instanceof UnaryExpression && this.right.op == "-") {
                        return new BinaryExpression(this.left, "-", this.right.operand);
                    }
               } else if (this.op == "-") {
                   if (leftFloat == 0) {
                       let idExp = getIdExp(this.right);
                       return new UnaryExpression("-", idExp);
                   } else if (rightFloat == 0) {
                       return this.left;
                   } else if (this.left === this.right) {
                       return new IntLit("0");
                   } else if (this.right instanceof UnaryExpression && this.right.op == "-") {
                       return new BinaryExpression(this.left, "+", this.right);
                   }
               } else if (this.op == "/") {
                   if (leftFloat == 0) {
                       return new IntLit("0");
                   } else if (rightFloat == 1) {
                       return this.left;
                   } else if (this.left === this.right) {
                       return new IntLit("1");
                   }
               } else if (this.op == "*") {
                   if (leftFloat == 0 || rightFloat == 0) {
                       return new IntLit("0");
                   } else if (leftFloat == 1) {
                       return this.right;
                   } else if (rightFloat == 1) {
                       return this.left;
                   }
               } else if (this.op == "%") {
                   if (rightFloat == 1 || leftFloat == 0 || (this.left === this.right)) {
                       return new IntLit("0");
                   }
               }
        }


        // Constant Folding
        if (this.op == "||") {
            if (getValue(this.left) == "true") {
                return new BoolLit("true");
            } else {
                return new BoolLit(getValue(this.right))
            }
        } else if (this.op == "&&") {
            if (getValue(this.left) == "false") {
                return new BoolLit("false");
            } else {
                return new BoolLit(getValue(this.right))
            }
        } else if (!isNaN(leftFloat) && !isNaN(rightFloat)) {
            if (this.op == "+") {
               let answer = leftFloat + rightFloat;
               return returnNumber(this.type, answer.toString());
           } else if (this.op == "-") {
               let answer = leftFloat - rightFloat;
               return returnNumber(this.type, answer.toString());
           } else if (this.op == "/") {
               let answer = leftFloat / rightFloat;
               return returnNumber(this.type, answer.toString());
           } else if (this.op == "*") {
               let answer = leftFloat * rightFloat;
               return returnNumber(this.type, answer.toString());
           } else if (this.op == "<=") {
               let answer = leftFloat <= rightFloat;
               return new BoolLit(answer.toString());
           } else if (this.op == "<") {
               let answer = leftFloat < rightFloat;
               return new BoolLit(answer.toString());
           } else if (this.op == ">=") {
               let answer = leftFloat >= rightFloat;
               return new BoolLit(answer.toString());
           } else if (this.op == ">") {
               let answer = leftFloat > rightFloat;
               return new BoolLit(answer.toString());
           } else if (this.op == "^") {
               let answer = Math.pow(leftFloat, rightFloat);
               return returnNumber(this.type, answer.toString());
           } else if (this.op == "//") {
               let answer = Math.floor(leftFloat / rightFloat);
               return returnNumber(this.type, answer.toString());
           } else if (this.op == "%") {
               let answer = leftFloat % rightFloat;
               return returnNumber(this.type, answer.toString());
           }
        } else if (this.op == "==") {
            let answer = getValue(this.left) == getValue(this.right);
            return new BoolLit(answer.toString());
        } else if (this.op == "!=") {
            let answer = getValue(this.left) != getValue(this.right);
            return new BoolLit(answer.toString());
        }
        return this;
    }
}

class UnaryExpression extends Expression {
    constructor(op, operand) {
        super();
        this.op = op;
        this.operand = operand;
        this.type;
    }
    analyze(context) {

        let expectedTypes;
        let inferredType;

        if (this.op == "--" || this.op == "++") {
            expectedTypes = [TYPE.INTEGER];
            inferredType = TYPE.INTEGER;
        } else if (this.op == "-") {
            expectedTypes = [TYPE.INTEGER, TYPE.FLOAT];
            inferredType = TYPE.FLOAT;
        } else if (this.op == "!") {
            expectedTypes = [TYPE.BOOLEAN];
            inferredType = TYPE.BOOLEAN;
        }

        this.operand.analyze(context);

        if (this.operand.type == "undefined") {
            this.operand.enforceType(inferredType, context);
        }

        context.assertUnaryOperandIsOneOfTypes(this.op, expectedTypes, this.operand.type);

        this.type = this.operand.returnType ? this.operand.returnType : this.operand.type;
    }
    enforceType(type, context) {
        if (this.operand.type == "undefined") {
            this.operand.enforceType(type, context);
            this.type = this.operand.type;
        }
        if (!canBeA(this.operand.type, type)) {
            context.throwCantResolveTypesError(this.operand.type, type);
        }
    }
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(${this.op}\n${this.operand.toString(++indent)}\n${spacer.repeat(--indent)})`;
    }
    optimize() {
        this.operand = this.operand.optimize();
        return this;
    }
}

class ParenthesisExpression extends Expression {
    constructor(exp) {
        super();
        this.exp = exp;
        this.value;
        this.type;
    }
    analyze(context) {
        this.exp.analyze(context);
        this.value = getValue(this.exp);
        this.type = this.exp.returnType ? this.exp.returnType : this.exp.type;
    }
    enforceType(type, context) {
        if (this.exp.type == "undefined") {
            this.exp.enforceType(type, context);
            this.type = this.exp.type;
        }
        if (!canBeA(this.exp.type, type)) {
            context.throwCantResolveTypesError(this.exp.type, type);
        }
    }
    toString(indent = 0) {
        // Don't increase indent, as the semantic meaning of parenthesis are already captured in the tree
        return `${this.exp.toString(indent)}`;
    }
    optimize() {
        this.exp = this.exp.optimize();
        return this;
    }
}

class Variable extends Expression {
    constructor(variable) {
        super();
        this.var = variable;
        this.id;
        this.value;
        this.type;
        this.returnType;
        this.context;
    }
    analyze(context, beingAssignedTo = false) {
        this.var.analyze(context, beingAssignedTo);
        try {
            this.value = getValue(this.var) || context.get(this.var.id).value;
        } catch(err) {
            this.value = "undefined";
        }
        this.id = this.var.id ? this.var.id : this.value;
        this.type = this.var.type;
        this.returnType = this.var.returnType;
        this.context = context;
    }
    enforceType(type, context) {
        if (this.type == "undefined") {
            this.var.enforceType(type, context);
            this.type = this.var.type;
        }
        if (!canBeA(this.type, type)) {
            context.throwCantResolveTypesError(this.type, type);
        }
        this.returnType = this.var.returnType;
    }
    toString(indent = 0) {
        // Don't increase indent, we already know literals and other data types are variables
        return `${this.var.toString(indent)}`;
    }
    optimize() {
        this.var = this.var.optimize();
        this.analyze(this.context);
        return this;
    }
}

class IdExpression extends Expression {
    constructor(idExpBody, idPostOp) {
        super();
        this.idExpBody = idExpBody;
        this.idPostOp = idPostOp;
        this.id;  // baseline identifier. example: x in x.doThis(3)[1].lalala
        this.type;
        this.returnType;
    }
    analyze(context, beingAssignedTo = false) {
        this.idExpBody.analyze(context, beingAssignedTo);
        if (this.idPostOp == "++" || this.idPostOp == "--") {
            context.assertUnaryOperandIsOneOfTypes(this.idPostOp, [TYPE.INTEGER], this.idExpBody.type)
        }
        this.id = this.idExpBody.id;
        this.type = this.idExpBody.returnType ? this.idExpBody.returnType : this.idExpBody.type;
        this.returnType = this.idExpBody.returnType;
    }
    enforceType(type, context) {
        if (this.type == "undefined") {
            this.idExpBody.enforceType(type, context);
            this.type = this.idExpBody.type;
            this.returnType = this.returnType;
        }
    }
    toString(indent = 0) {
        return  `${spacer.repeat(indent)}(IdExpression\n` +
                `${this.idExpBody.toString(++indent)}` +
                `${(!this.idPostOp) ? "" : `\n${spacer.repeat(++indent)}${this.idPostOp}`}` +
                `\n${spacer.repeat(--indent)})`;
    }
    optimize() {
        this.idExpBody = this.idExpBody.optimize();
        return this;
    }
}

class IdExpressionBodyRecursive {
    constructor(idExpBody, idAppendage) {
        this.idExpBody = idExpBody;
        this.idAppendage = idAppendage;
        this.appendageOp = idAppendage === 'undefined' ? 'undefined' : idAppendage.getOp();
        this.id;
        this.type;
        this.returnType;
    }
    analyze(context, beingAssignedTo = false) {
        this.idExpBody.analyze(context, beingAssignedTo);
        this.id = this.idExpBody.id;

        if (this.appendageOp === "[]") {
            this.idAppendage.analyze(context);
            if (this.idExpBody.type == "undefined") {
                this.idExpBody.enforceType(TYPE.LIST, context);
            }
            context.assertIsValidListAccess(this.idExpBody.type, this.idAppendage.type);  // TODO: this.idAppendage.type is undefined
            this.type = context.get(this.idExpBody.id).elementType;
        } else if (this.appendageOp === ".") {
            this.idAppendage.analyze(context);
            if (this.idExpBody.type == "undefined") {
                this.idExpBody.enforceType(TYPE.DICTIONARY, context);
            }
            context.assertIsValidListAccess(this.idExpBody.type, this.idAppendage.type);
            this.type = context.get(this.idExpBody.id).elementType;
        } else if (this.appendageOp === "()") {
            this.idAppendage.analyze(context);
            let entry = context.get(this.idExpBody.id);
            if (entry.type !== TYPE.FUNCTION) {
                context.throwNotAFunctionError(this.idExpBody.id);
            }
            if (!canArgumentsFitParameters(this.idAppendage.signature, entry.parameters)) {
                context.throwParameterArgumentMismatchError(this.idExpBody.id, entry.parameters, this.idAppendage.signature);
            }
        }
        this.returnType = this.idExpBody.returnType;
    }
    enforceType(type, context) {
        if (this.appendageOp === "[]") {
            this.returnType = type;
        }
        if (this.type == "undefined") {
            this.idExpBody.enforceType(type, context, returnType, undeclaredIds);
            this.type = this.idExpBody.type;
            this.returnType = this.idExpBody.returnType;
        }
    }
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(${this.appendageOp}` +
               `\n${this.idExpBody.toString(++indent)}` +
               `\n${this.idAppendage.toString(indent)}` +
               `\n${spacer.repeat(--indent)})`;
    }
    optimize() {
        this.idExpBody = this.idExpBody.optimize();
        this.idAppendage = this.idAppendage.optimize();
        return this;
    }
}

class IdExpressionBodyBase {
    constructor(id) {
        this.id;
        this.idExpBase = id;
        this.value;
        this.type;
        this.returnType;
    }
    analyze(context, beingAssignedTo = false) {
        this.idExpBase.analyze(context, beingAssignedTo);
        this.id = this.idExpBase.id;
        this.value = this.idExpBase.value;
        this.type = this.idExpBase.type;
        this.returnType = this.idExpBase.returnType;
    }
    enforceType(type, context, returnType = "undefined") {
        if (this.type === "undefined") {
            if (context.isUndeclaredParameter(this.id)) {
                this.type = type;
                if (returnType !== "undefined") {
                    context.setVariable(this.id, {type: type, returnType: returnType, value: this.value});
                    this.returnType = returnType;
                } else {
                    context.setVariable(this.id, {type: type, value: this.value});
                }
                context.removeUndeclaredParameter(this.id);
            } else {
                context.throwUseBeforeDeclarationError(this.id);
            }
        }
        if (!canBeA(context.get(this.id).type, type)) {
            this.context.throwCantResolveTypesError(this.type, type);
        }
    }
    toString(indent = 0) {
        return this.idExpBase === "this" ? `${spacer.repeat(indent)}(${this.idExpBase})` : `${spacer.repeat(indent)}${this.idExpBase.toString(indent)}`;
    }
    optimize() {
        this.idExpBase = this.idExpBase.optimize();
        return this;
    }
}

class PeriodId {
    constructor(id) {
        this.id = id;
    }
    analyze(context) {

        // TODO: Need to work on more pressing issues so will improve the obviously flawed dictionary access later
        // this.variable.analyze(context);
        // if (this.variable.type == "undefined") {
        //     this.variable.enforceType(TYPE.INTEGER, context);
        // }
        this.type = TYPE.STRING; //this.variable.type;
    }
    getOp() {
        return ".";
    }
    toString(indent = 0) {
        return `${spacer.repeat(indent)}${this.id.toString(++indent)}`;
    }
    optimize() {
        this.id = this.id.optimize();
        return this;
    }
}

class Arguments {
    constructor(args) {
        this.args = args;
        this.signature = [];
    }
    analyze(context) {
        let self = this;
        this.args.analyze(context);
        this.signature = this.args.signature;
    }
    getOp() {
        return "()";
    }
    toString(indent = 0) {
        var string = `${spacer.repeat(indent)}(Arguments`;
        if (this.args.length > 0) {
            string += `\n${this.args.toString(++indent)}` +
                      `\n${spacer.repeat(--indent)})`;
        } else {
          string += `)`
        }
        return string;
    }
    optimize() {
        this.args.forEach(a => a.optimize());
        this.args.filter(a => a !== null);
        return this;
    }
}

class IdSelector {
    constructor(variable) {
        this.variable = variable;
        this.type;
    }
    analyze(context) {
        this.variable.analyze(context);
        if (this.variable.type == "undefined") {
            this.variable.enforceType(TYPE.INTEGER, context);
        }
        this.type = this.variable.type;
    }
    getOp() {
        return "[]";
    }
    toString(indent = 0) {
        return `${this.variable.toString(indent)}`;
    }
    optimize() {
        this.variable = this.variable.optimize();
        return this;
    }
}

class List {
    constructor(varList) {
        this.varList = varList;
        this.type = TYPE.LIST;
        this.elementType;
    }
    analyze(context) {
        let self = this;
        this.varList.analyze(context);
        this.elementType = this.varList.elementType;
    }
    toString(indent = 0) {
        var string = `${spacer.repeat(indent)}(List`;
        if (this.varList.length > 0) {
            string += `\n${this.varList.toString(++indent)}` +
                      `\n${spacer.repeat(--indent)})`;
        } else {
            string += `)`;
        }
        return string;
    }
    optimize() {
        this.varList.forEach(v => v.optimize());
        this.varList.filter(v => v !== null);
    }
}

class Tuple {
    constructor(elems) {
        this.elems = elems;
        this.type = TYPE.TUPLE
        this.elementType;
    }
    analyze(context) {
        let self = this;
        this.elems.analyze(context);
        this.elementType = this.elems.elementType;
    }
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(Tuple` +
               `\n${this.elems.toString(++indent)}` +
               `\n${spacer.repeat(--indent)})`;
    }
    optimize() {
        this.elems = this.elems.optimize();
        return this;
    }
}

class Dictionary {
    constructor(idValuePairs) {
        this.idValuePairs = idValuePairs;
        this.type = TYPE.DICTIONARY;
        this.keyType = TYPE.STRING;
        this.valueType;
    }
    analyze(context) {
        for (let p in this.idValuePairs) {
            this.idValuePairs[p].analyze(context);
        }
        if (this.idValuePairs.length >= 1) {
            this.valueType = this.idValuePairs[0].variable.type;
            for (let p in this.idValuePairs) {
                context.assertTypesAreHomogeneous(this.valueType, this.idValuePairs[p].variable.type);
            }
        }
    }
    toString(indent = 0) {
        var string = `${spacer.repeat(indent++)}(Dictionary`
        if (this.idValuePairs.length !== 0) {
            for (var pairIndex in this.idValuePairs) {
                string += `\n${this.idValuePairs[pairIndex].toString(indent)}`;
            }
            string += `\n${spacer.repeat(--indent)})`;
        } else {
          string += `)`;
        }
        return string;
    }
    optimize() {
        this.idValuePairs.forEach(p => p.optimize());
        this.idValuePairs.filter(p => p !== null);
        return this;
    }
}

class IdValuePair {
    constructor(id, variable) {
        this.id = id;
        this.variable = variable;
    }
    analyze(context) {
        this.variable.analyze(context);
    }
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(${this.id} : ${this.variable.toString()})`;
    }
    optimize() {
        this.variable = this.variable.optimize();
        return this;
    }
}

class VarList {
    constructor(variables) {
        this.variables = variables;
        this.length = variables.length;
        this.signature = [];
        this.elementType;
    }
    analyze(context) {
        let self = this;
        this.variables.forEach(function(variable) {
            variable.analyze(context);
            self.signature.push(variable.type)
        });
        if (this.variables[0]) {  // This is horrendous code but we're running out of time
            this.elementType = this.variables[0].type;
        }
    }
    toString(indent = 0) {
        var string = `${spacer.repeat(indent++)}(VarList`;
        if (this.variables.length !== 0) {
            for (var variable in this.variables) {
                string += `\n${this.variables[variable].toString(indent)}`
            }
            string += `\n${spacer.repeat(--indent)})`;
        } else {
          string += `)`;
        }
        return string;
    }
    optimize() {
        this.variables.forEach(v => v.optimize());
        this.variables.filter(v => v !== null);
        return this;
    }
}

class IntLit {
    constructor(digits) {
        this.value = digits;
        this.type = TYPE.INTEGER;
    }
    analyze() {}
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(${this.value})`;
    }
    optimize() {
        return this;
    }
}

class FloatLit {
    constructor(value) {
        this.value = value;
        this.type = TYPE.FLOAT;
    }
    analyze() {}
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(${this.value})`;
    }
    optimize() {
        return this;
    }
}

class StringLit {
    constructor(value) {
        this.value = value.substring(1, value.length - 1);
        this.type = TYPE.STRING;
    }
    analyze() {}
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(${this.value})`;
    }
    optimize() {
        return this;
    }
}

class BoolLit {
    constructor(boolVal) {
        this.value = boolVal;
        this.type = TYPE.BOOLEAN;
    }
    analyze() {}
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(${this.value})`;
    }
    optimize() {
        return this;
    }
}

class NullLit {
    constructor() {
        this.value = "null"
        this.type = TYPE.NULL
    }
    analyze() {}
    toString(indent = 0) {
        return `${spacer.repeat(indent)}(${this.value})`;
    }
    optimize() {
        return this;
    }
}

class IdVariable {
    constructor(letters) {
        this.id = letters;
        this.type;
        this.returnType;
    }
    analyze(context, beingAssignedTo = false) {
        let entry = context.get(this.id, true);
        this.type = (typeof entry !== "undefined") ? entry.type : "undefined";
        this.returnType = (typeof entry !== "undefined") ? entry.returnType : "undefined";
        if (this.type === "undefined" && !context.isUndeclaredParameter(this.id) && !beingAssignedTo) {
            context.throwUseBeforeDeclarationError(this.id);
        }
    }
    enforceType(type, context, returnType = "undefined") {
        if (this.type === "undefined") {
            if (context.isUndeclaredParameter(this.id)) {
                this.type = type;
                if (returnType !== "undefined") {
                    context.setVariable(this.id, {type: type, returnType: returnType, value: this.value});
                    this.returnType = returnType;
                } else {
                    context.setVariable(this.id, {type: type, value: this.value});
                }
                context.removeUndeclaredParameter(this.id);
            } else {
                context.throwUseBeforeDeclarationError(this.id);
            }
        }
        if (!canBeA(context.get(this.id).type, type)) {
            this.context.throwCantResolveTypesError(this.type, type);
        }
    }
    toString(indent = 0) {
        return `(IdVariable` +
                `\n${spacer.repeat(++indent)}(${this.id})` +
                `\n${spacer.repeat(--indent)})`;
    }
    optimize() {
        return this;
    }
}

class ConstId {
    constructor(letters) {
        this.id = letters;
        this.value = this.id;
        this.type;
        this.returnType;
    }
    analyze(context, beingAssignedTo = false) {
        let entry = context.get(this.id, true);
        this.type = (typeof entry !== "undefined") ? entry.type : "undefined";
        this.returnType = (typeof entry !== "undefined") ? entry.returnType : "undefined";
        if (this.type === "undefined" && !context.isUndeclaredParameter(this.id) && !beingAssignedTo) {
            context.throwUseBeforeDeclarationError(this.id);
        }
    }
    enforceType(type, context, returnType = "undefined") {
        if (this.type === "undefined") {
            if (context.isUndeclaredParameter(this.id)) {
                this.type = type;
                if (returnType !== "undefined") {
                    context.setVariable(this.id, {type: type, returnType: returnType, value: this.value});
                    this.returnType = returnType;
                } else {
                    context.setVariable(this.id, {type: type, value: this.value});
                }
                context.removeUndeclaredParameter(this.id);
            } else {
                context.throwUseBeforeDeclarationError(this.id);
            }
        }
        if (!canBeA(context.get(this.id).type, type)) {
            this.context.throwCantResolveTypesError(this.type, type);
        }
    }
    toString(indent = 0) {
        return `(ConstId` +
                `\n${spacer.repeat(++indent)}(${this.id})` +
                `\n${spacer.repeat(--indent)})`;
    }
    optimize() {
        return this;
    }
}

class ClassId {
    constructor(className) {
        this.id = className;
        this.value = this.id;
        this.type;
        this.returnType;
    }
    analyze(context, beingAssignedTo = false) {
        let entry = context.get(this.id, true);
        this.type = (typeof entry !== "undefined") ? entry.type : "undefined";
        this.returnType = (typeof entry !== "undefined") ? entry.returnType : "undefined";
        if (this.type === "undefined" && !context.isUndeclaredParameter(this.id) && !beingAssignedTo) {
            context.throwUseBeforeDeclarationError(this.id);
        }
    }
    enforceType(type, context, returnType = "undefined") {
        if (this.type === "undefined") {
            if (context.isUndeclaredParameter(this.id)) {
                this.type = type;
                if (returnType !== "undefined") {
                    context.setVariable(this.id, {type: type, returnType: returnType, value: this.value});
                    this.returnType = returnType;
                } else {
                    context.setVariable(this.id, {type: type, value: this.value});
                }
                context.removeUndeclaredParameter(this.id);
            } else {
                context.throwUseBeforeDeclarationError(this.id);
            }
        }
        if (!canBeA(context.get(this.id).type, type)) {
            this.context.throwCantResolveTypesError(this.type, type);
        }
    }
    toString(indent = 0) {
        return `(ClassId` +
                `\n${spacer.repeat(++indent)}(${this.id})` +
                `\n${spacer.repeat(--indent)})`;
    }
    optimize() {
        return this;
    }
}

module.exports = {
    Program: Program,
    Block: Block,
    BranchStatement: BranchStatement,
    FunctionDeclarationStatement: FunctionDeclarationStatement,
    ClassDeclarationStatement: ClassDeclarationStatement,
    MatchStatement: MatchStatement,
    BranchStatement: BranchStatement,
    WhileStatement: WhileStatement,
    ForInStatement: ForInStatement,
    PrintStatement: PrintStatement,
    AssignmentStatement: AssignmentStatement,
    IdentifierStatement: IdentifierStatement,
    ReturnStatement: ReturnStatement,
    MatchExpression: MatchExpression,
    Match: Match,
    Parameter: Parameter,
    BinaryExpression: BinaryExpression,
    UnaryExpression: UnaryExpression,
    ParenthesisExpression: ParenthesisExpression,
    Variable: Variable,
    IdExpression: IdExpression,
    IdExpressionBodyRecursive: IdExpressionBodyRecursive,
    IdExpressionBodyBase: IdExpressionBodyBase,
    PeriodId: PeriodId,
    Arguments: Arguments,
    IdSelector: IdSelector,
    List: List,
    Tuple: Tuple,
    Dictionary: Dictionary,
    IdValuePair: IdValuePair,
    VarList: VarList,
    BoolLit: BoolLit,
    IntLit: IntLit,
    FloatLit: FloatLit,
    StringLit: StringLit,
    NullLit: NullLit,
    IdVariable: IdVariable,
    ConstId: ConstId,
    ClassId: ClassId,
    Types: TYPE
};
