/// <reference path="typescript/node-0.12.0.d.ts" />

import util   = require('util')
import AST    = require('./ast')
import errors = require('./errors')
import scope  = require('./typesystem/scope')
import types  = require('./types')

var inherits     = util.inherits,
    inspect      = util.inspect,
    Scope        = scope.Scope,
    ClosingScope = scope.ClosingScope,
    TypeError    = errors.TypeError

class TypeSystem {
  root:     scope.Scope
  file:     any
  compiler: any
  constructor() {
    this.root = new Scope(null)
    this.root.isRoot = true
    this.bootstrap()
    // File and compiler will be null when not actively walking a tree
    this.file     = null
    this.compiler = null
  }

  // Mixed in by `./typesystem/bootstrap`
  bootstrap: () => void

  // Forward definitions for prototyped utility
  findByName: (string) => types.Type
  resolveType: (node: AST.Node, scope: scope.Scope) => types.Type
  resolveExpression: (expr: any, scope: scope.Scope, immediate: any) => types.Type
  getAllReturnTypes: (block: AST.Block) => any[]
  getTypeOfTypesProperty: (type: any, name: string) => types.Type
  setupThisInScope: (klass: types.Object, scope: scope.Scope) => void

  // Forward definitions for prototyped walking functions
  walk: (rootNode: AST.Root, file: any, compiler: any) => void
  visitBlock:             (node: AST.Block,      scope: scope.Scope) => void
  visitStatement:         (node,                 scope, parentNode) => void
  visitImport:            (node: AST.Import,     scope: scope.Scope, parentNode: AST.Node) => void
  visitExport:            (node: AST.Export,     scope: scope.Scope, parentNode: AST.Node) => void
  visitClass:             (node: AST.Class,      scope: scope.Scope) => void
  visitClassDefinition:   (node: AST.Block,      scope: scope.Scope, klass: types.Object) => void
  visitClassFunction:     (node: AST.Function,   scope: scope.Scope, klass: types.Object, searchInParent: Function) => void
  visitClassMulti:        (node: AST.Multi,      scope: scope.Scope, klass: types.Object) => void
  visitFor:               (node: AST.For,        scope: scope.Scope) => void
  visitIf:                (node: AST.If,         scope: scope.Scope) => void
  visitWhile:             (node: AST.While,      scope: scope.Scope) => void
  visitReturn:            (node: AST.Return,     scope: scope.Scope, parentNode: AST.Node) => void
  visitPath:              (node: AST.Assignment, scope: scope.Scope) => void
  visitLet:               (node: AST.Assignment, scope: scope.Scope) => void
  visitVar:               (node: AST.Assignment, scope: scope.Scope) => void
  visitExpression:        (node: AST.Node,       scope: scope.Scope, immediate: any) => void
  visitLiteral:           (node: AST.Literal,    scope: scope.Scope) => void
  visitNew:               (node: AST.New,        scope: scope.Scope) => void
  visitBinary:            (node: AST.Binary,     scope: scope.Scope) => void
  visitMulti:             (node: AST.Multi,      scope: scope.Scope) => void
  visitFunction:          (node: AST.Function,   parentScope: scope.Scope, immediate: any) => void
  visitMultiFunction:     (node: AST.Function,   scope: scope.Scope, multiNode: AST.Multi) => void
  visitNamedFunction:     (node: AST.Function,   scope: scope.Scope) => void
  visitFunctionStatement: (node: AST.Function,   scope: scope.Scope, searchInParent: Function) => void
  visitIdentifier:        (node: AST.Identifier, scope: scope.Scope) => void
  visitCall:              (node: AST.Call,       scope: scope.Scope) => void
  visitGroup:             (node: AST.Group,      scope: scope.Scope) => void
  visitChild:             (node: AST.Node, child: AST.Node, scope: scope.Scope) => void
}
// Add the bootstrap methods to the TypeSystem
require('./typesystem/bootstrap')(TypeSystem)

TypeSystem.prototype.findByName = function (name) {
  if (typeof name !== 'string') {
    throw new Error('Non-string name for type lookup')
  }
  return this.root.getLocal(name)
}

function uniqueWithComparator (array, comparator) {
  var acc    = [],
      length = array.length
  for (var i = 0; i < length; i++) {
    for (var j = i + 1; j < length; j++) {
      var a = array[i],
          b = array[j]
      if (comparator(a, b)) { j = ++i }
    }
    acc.push(array[i])
  }
  return acc
}

function assertInstanceOf(value, type, msg?) {
  if (value instanceof type) { return; }
  if (!msg) {
    msg = 'Incorrect type; expected '+type.name+', got '+value.constructor.name
  }
  throw new Error(msg)
}


// AST typing -----------------------------------------------------------------

TypeSystem.prototype.walk = function (rootNode, file, compiler) {
  assertInstanceOf(rootNode, AST.Root, "Node must be root")
  this.file     = file     ? file     : null
  this.compiler = compiler ? compiler : null

  var topLevelScope = new Scope(this.root)
  // Save this top-level scope on the root
  rootNode.scope = topLevelScope

  var self = this
  rootNode.statements.forEach(function (stmt) {
    self.visitStatement(stmt, topLevelScope, rootNode)
  })
  // Reset the compiler property now that we're done walking
  this.file     = null
  this.compiler = null
}

TypeSystem.prototype.visitBlock = function (node: AST.Block, scope) {
  if (node.scope) {
    throw new TypeError('Scope already established for block', node)
  }
  // Save the scope for this block for later use by target compilers
  node.scope = scope

  var self = this
  node.statements.forEach(function (stmt) {
    self.visitStatement(stmt, scope, node)
  })
}

function createSearchInParent (parentNode: any) {
  return function (cb: (stmt: AST.Node) => boolean): AST.Node {
    var statements = parentNode.statements,
        found      = null
    // Call `cb` on each statement of the parent until it returns true
    for (var i = statements.length - 1; i >= 0; i--) {
      var stmt = statements[i],
          ret  = cb(stmt)
      if (ret === true) {
        found = stmt
        break
      }
    }
    return found
  }// return function
}// createSearchInParent

TypeSystem.prototype.visitStatement = function (node, scope, parentNode) {
  switch (node.constructor) {
    case AST.Assignment:
      if (node.lvalue instanceof AST.Let) {
        this.visitLet(node, scope)
      } else if (node.lvalue instanceof AST.Var) {
        this.visitVar(node, scope)
      } else if (node.lvalue instanceof AST.Identifier) {
        this.visitPath(node, scope)
      } else {
        var lvalue = node.lvalue,
            name   = lvalue.constructor.name
        throw new TypeError('Cannot visit Assignment with: '+lvalue+' ('+name+')', node)
      }
      break
    case AST.If:
      this.visitIf(node, scope)
      break
    case AST.While:
      this.visitWhile(node, scope)
      break
    case AST.For:
      this.visitFor(node, scope)
      break
    case AST.Return:
      this.visitReturn(node, scope, parentNode)
      break
    case AST.Binary:
      if (node.isBinaryStatement()) {
        this.visitBinary(node, scope)
      } else {
        throw new TypeError('Cannot visit non-statement binary: '+node.op)
      }
      break
    case AST.Identifier:
      this.visitIdentifier(node, scope)
      break
    case AST.Multi:
      this.visitMulti(node, scope)
      break
    case AST.Function:
      // Create the searcher in this parent node
      // TODO: Maybe just pass along the parent node rather than generating
      //       a whole new anonymous function every time we encounter a
      //       function statement?
      this.visitFunctionStatement(node, scope, createSearchInParent(parentNode))
      break
    case AST.Class:
      this.visitClass(node, scope)
      break
    case AST.Import:
      this.visitImport(node, scope, parentNode)
      break
    case AST.Export:
      this.visitExport(node, scope, parentNode)
      break
    case AST.Call:
      this.visitCall(node, scope)
      break
    default:
      throw new TypeError("Don't know how to visit: "+node.constructor.name, node)
      break
  }
}


TypeSystem.prototype.visitImport = function (node: AST.Import, scope, parentNode) {
  assertInstanceOf(node,       AST.Import)
  assertInstanceOf(node.name,  String,   "Import expects String as path")
  assertInstanceOf(parentNode, AST.Root, "Import can only be a child of a Root")
  if (!this.compiler) {
    throw new Error('Type-system not provided with current Compiler instance')
  }
  if (!this.file) {
    throw new Error('Type-system not provided with current File instance')
  }
  // Add ourselves to the root's list of imports it contains
  parentNode.imports.push(node)

  var moduleName = node.name
  // Preserve current file to restore after visiting the imported file
  var currentFile = this.file
  // Now ask the compiler to import the file
  var importedFile = this.compiler.importFileByName(moduleName)
  node.file = importedFile
  // Restore the current file and push the imported file as a dependency of it
  this.file = currentFile
  this.file.dependencies.push(importedFile)
  // Then build a module object for it
  var module        = new types.Module(moduleName.toString()),
      exportedNames = Object.keys(importedFile.exports)
  for (var i = exportedNames.length - 1; i >= 0; i--) {
    var name = exportedNames[i],
        type = importedFile.exports[name]
    // Add the exported name-type pair to the module and set it as a
    // read-only property
    module.setTypeOfProperty(name, type)
    module.setFlagsOfProperty(name, 'r')
  }
  if (node.using) {
    assertInstanceOf(node.using, Array)
    for (var i = 0; i < node.using.length; i++) {
      var use = node.using[i],
          useType = module.getTypeOfProperty(use)
      scope.setLocal(use, new types.Instance(useType))
    }
  } else {
    // If there's no `using` then just add the whole module
    scope.setLocal(moduleName, module)
  }
  // Now create a faux instance of this module and add it to the scope
  // scope.setLocal(moduleName, new types.Instance(module))
}


TypeSystem.prototype.visitExport = function (node: AST.Export, scope, parentNode) {
  // Make sure our parent node is the root
  assertInstanceOf(parentNode, AST.Root, "Import can only be a child of a Root")
  // Add ourselves to the root node's list of export nodes
  parentNode.exports.push(node)

  var name = node.name
  // Make sure we're in the top-level scope
  if (scope.parent !== this.root) {
    throw new TypeError('Exporting from non-root scope', node)
  }
  // Look up the type for the name in the root
  var type = scope.getLocal(name)
  this.file.module.setTypeOfProperty(name, type)
  // Need to unbox an instance if we encounter one
  if (type instanceof types.Instance) {
    type = type.type
  }
  node.type = type
  // TODO: Check that the name is a constant binding (rather than variable)
  this.file.exports[name] = type
}


TypeSystem.prototype.visitClass = function (node: AST.Class, scope) {
  var rootObject = this.rootObject,
      name       = node.name,
      classScope = new Scope(scope),
      klass      = null
  // Look for a class to extend first
  var foundClass = false
  try {
    foundClass = scope.get(name)
  } catch (err) { /* pass */ }
  // If we found a class then go ahead and try to extend it
  if (foundClass !== false) {
    klass = foundClass
    // Visit the extending definition and then return
    this.visitClassDefinition(node.definition, classScope, klass)
    node.type = klass
    return
  }
  // Create a new Object type with the root object as the supertype
  klass = new types.Object(rootObject)
  klass.name = name
  klass.intrinsic = false
  scope.setLocal(klass.name, klass)
  scope.setFlagsForLocal(klass.name, Scope.Flags.Constant)
  // Now create a new scope and visit the definition in that scope
  this.visitClassDefinition(node.definition, classScope, klass)
  // Set the class as the node's type
  node.type = klass
}

// Given a class type and a scope, sets up `this` bindings in that scope
// for instances of that class (with proper constant flags)
TypeSystem.prototype.setupThisInScope = function (klass: types.Object, scope: scope.Scope) {
  scope.setLocal('this', new types.Instance(klass))
  scope.setFlagsForLocal('this', Scope.Flags.Constant)
}

TypeSystem.prototype.visitClassDefinition = function (node: AST.Block, scope, klass) {
  var self = this
  node.statements.forEach(function (stmt) {
    switch (stmt.constructor) {
      case AST.Assignment:
        var assg: AST.Assignment = stmt

        if (assg.type !== 'var' && assg.type !== 'let') {
          throw new TypeError('Unexpected assignment type: '+assg.type, assg) }
        if (assg.type === 'let') {
          assertInstanceOf(assg.lvalue, AST.Let) }
        if (assg.type === 'var') {
          assertInstanceOf(assg.lvalue, AST.Var) }

        var lvalue       = <AST.Let>assg.lvalue,
            propertyName = lvalue.name
        // Check that there's a type specified for this slot
        if (!lvalue.immediateType) {
          throw new TypeError('Missing type for class slot: '+propertyName)
        }
        var propertyType = self.resolveType(lvalue.immediateType, scope)
        // Visit and then check that the default (rvalue) is constant if present
        if (assg.rvalue) {
          self.visitExpression(assg.rvalue, scope)
        }
        // TODO: Smarter checking of constant-ness of default values when it's "let"
        if (assg.rvalue && !(assg.rvalue instanceof AST.Literal)) {
          throw new TypeError('Cannot handle non-literal default for property: '+propertyName)
        }
        // Create the property on the object with the resolved type
        klass.setTypeOfProperty(propertyName, propertyType)
        // Add read-only flags for this property when the assignment .type is "let"
        if (assg.type === 'let') {
          klass.setFlagsOfProperty(propertyName, 'r')
        }
        break
      case AST.Function:
        self.visitClassFunction(stmt, scope, klass, createSearchInParent(node))
        break
      case AST.Init:
        var initType  = new types.Function(self.rootObject),
            initScope = new Scope(scope)
        // Add an instance of 'this' for the initializer's scope
        self.setupThisInScope(klass, initScope)
        // Resolve the arguments
        var args = []
        stmt.args.forEach(function (arg) {
          var type = self.resolveType(arg.type)
          initScope.setLocal(arg.name, new types.Instance(type))
          args.push(type)
        })
        initType.args = args
        initType.ret  = self.root.getLocal('Void')
        // Then visit the block with the new scope
        self.visitBlock(stmt.block, initScope)
        // Add the Function init type to the class and to this initializer node
        klass.addInitializer(initType)
        stmt.type = initType
        break
      case AST.Multi:
        self.visitClassMulti(stmt, scope, klass)
        break
      default:
        throw new TypeError("Don't know how to visit '"+stmt.constructor.name+"' in class definition")
        break
    }
  })
}

TypeSystem.prototype.visitClassFunction = function (node, scope, klass, searchInParent) {
  var self         = this,
      functionName = node.name
  // Check that it's a function statement (ie. has a name)
  if (!functionName) {
    throw new TypeError('Missing function name', node)
  }

  // Now look up the parent `multi` in the containing block
  var multiNode: AST.Multi = searchInParent(function (stmt) {
    if (stmt.constructor === AST.Multi && stmt.name === functionName) {
      return true
    }
    return false
  })
  if (multiNode !== null) {
    var multiType: types.Multi = multiNode.type
    // Add this implementation to its list of functions and set the parent of
    // the function so that it knows not to codegen itself
    multiType.addFunctionNode(node)
    node.setParentMultiType(multiNode.type)

    // Fill out any missing types
    for (var i = 0; i < node.args.length; i++) {
      var arg = node.args[i]
      // Type is specified so we don't need to worry about it
      if (arg.type) { continue }
      // Set the argument's type to the multi argument's type
      arg.type = multiNode.args[i].type
    }
    // throw new TypeError('Compilation of multi functions in classes not yet implemented')
  }

  // Run the generic visitor to figure out argument and return types
  this.visitFunction(node, scope, function (functionType, functionScope) {
    assertInstanceOf(functionScope, ClosingScope, "Function's scope must be a ClosingScope")
    self.setupThisInScope(klass, functionScope)
  })
  var functionInstance = node.type
  // Unbox the instance generated by the visitor to get the pure
  // function type
  var functionType: types.Function = functionInstance.type
  // Let the function type know that it's an instance method (used by the compiler)
  functionType.isInstanceMethod = true

  if (multiNode === null) {
    // Add that function type as a property of the class
    // TODO: Maybe have a separate dictionary for instance methods
    klass.setTypeOfProperty(functionName, functionType)
  } else {
    node.setParentMultiType(multiType)
  }
}

TypeSystem.prototype.visitClassMulti = function (node: AST.Multi, thisScope, klass) {
  var emptyScope = new Scope(null)
  this.visitMulti(node, emptyScope)
  // Set up the multi on the class
  var multiType: types.Multi = node.type,
      multiName              = node.name
  // Add the multi as property of the class
  klass.setTypeOfProperty(multiName, multiType)
  // And let the type know it's an instance method
  multiType.isInstanceMethod = true
}

TypeSystem.prototype.visitFor = function (node: AST.For, scope) {
  this.visitStatement(node.init, scope)

  // If there's a condition present then we need to visit the expression
  // and type-check what it resolves to
  if (node.cond) {
    this.visitExpression(node.cond, scope)
    var condType = node.cond.type
    if (!condType) {
      throw new TypeError('Missing type of `for` condition', node.cond)
    }
    // Check that the condition resolves to a boolean
    if (!condType.equals(this.findByName('Boolean'))) {
      throw new TypeError('Expected `for` condition to resolve to a Boolean', node.cond)
    }
  }

  this.visitStatement(node.after, scope)

  var blockScope = new Scope(scope)
  this.visitBlock(node.block, blockScope)
}

TypeSystem.prototype.visitIf = function (node: AST.If, scope) {
  assertInstanceOf(node.block, AST.Block, 'Expected Block in If statement')

  this.visitExpression(node.cond, scope)

  // Handle the main if block
  var blockScope = new Scope(scope)
  this.visitBlock(node.block, blockScope)

  // Visit each of the else-ifs
  if (node.elseIfs) {
    for (var i = 0; i < node.elseIfs.length; i++) {
      var elseIf = node.elseIfs[i],
          elseIfBlockScope = new Scope(scope)
      this.visitExpression(elseIf.cond, scope)
      this.visitBlock(elseIf.block, elseIfBlockScope)
    }
  }
  // Handle the else block if present
  if (node.elseBlock) {
    var elseBlockScope = new Scope(scope)
    this.visitBlock(node.elseBlock, elseBlockScope)
  }
}

TypeSystem.prototype.visitWhile = function (node: AST.While, scope) {
  assertInstanceOf(node.block, AST.Block, 'Expected Block in While statement')

  this.visitExpression(node.expr, scope)

  var blockScope = new Scope(scope)
  this.visitBlock(node.block, blockScope)
}

TypeSystem.prototype.visitReturn = function (node: AST.Return, scope, parentNode) {
  if (node.expr === undefined) {
    throw new TypeError('Cannot handle undefined expression in Return')
  }
  var exprType: types.Instance = null
  if (node.expr === null) {
    var voidType = this.root.getLocal('Void')
    exprType = new types.Instance(voidType)
  } else {
    var expr = node.expr
    exprType = this.resolveExpression(expr, scope)
  }
  node.type = exprType
  // Handle the parent block if present
  if (parentNode) {
    if (!((parentNode instanceof AST.Block) || (parentNode instanceof AST.Root))) {
      throw new TypeError('Expected Block or Root as parent of Return', node)
    }
    // assertInstanceOf(parentNode, AST.Block, 'Expected Block as parent of Return')
    if (parentNode.returnType) {
      throw new TypeError('Block already has returned')
    }
    // The expression should return an instance, we'll have to unbox that
    assertInstanceOf(exprType, types.Instance, 'Expected Instance as argument to Return')
    parentNode.returnType = exprType.type
  }
}

TypeSystem.prototype.visitPath = function (node: AST.Assignment, scope) {
  var base = <AST.Identifier>node.lvalue
  assertInstanceOf(base, AST.Identifier, 'Path assignment must begin with an Identifier')

  this.visitIdentifier(base, scope)

  var current = null
  if (base.child) {
    current = base.child
    while (true) {
      if (current instanceof AST.Call) {
        throw new TypeError("Can't have Call in path assignment", current)
      }
      if (current instanceof AST.Identifier) {
        var parent       = current.parent,
            parentType   = parent.getInitialType(),
            propertyName = current.name

        assertInstanceOf(parentType, types.Instance)
        parentType = parentType.type

        if (parentType.hasPropertyFlag(propertyName, types.Flags.ReadOnly)) {
          throw new TypeError('Trying to path assign to read-only property', current)
        }
      }
      if (!current.child) { break }

      current = current.child
    }

  } else {
    current = base
  }

  // TODO: Check that there are no calls in this path and for any other
  //       things that may make the path-assignment impossible

  var lvalueType = current.type,
      rvalueType = this.resolveExpression(node.rvalue, scope)

  if (!lvalueType.equals(rvalueType)) {
    throw new TypeError('Unequal types in assignment: '+lvalueType.inspect()+' </> '+rvalueType.inspect(), node)
  }
}

TypeSystem.prototype.resolveType = function (node, scope) {
  var self = this
  switch (node.constructor) {
    case AST.FunctionType:
      var functionTypeNode = <AST.FunctionType>node
      var args = functionTypeNode.args.map(function (arg) { return self.resolveType(arg, scope) }),
          ret  = this.resolveType(functionTypeNode.ret, scope)
      // Build the type and return it
      return new types.Function(this.rootObject, args, ret)
    case AST.NameType:
      // TODO: Improve the handling and look-ups of these; right now they're way too naive
      var nameTypeNode = <AST.NameType>node
      return this.findByName(nameTypeNode.name)
    default:
      throw new Error("Can't walk: "+node.constructor['name'])
  }
}

TypeSystem.prototype.visitLet = function (node, scope) {
  var lvalueType: any = new types.Unknown(),
      lvalue          = <AST.Let>node.lvalue,
      name            = lvalue.name

  // If we have an explicit type then look it up
  if (lvalue.immediateType) {
    var immediateTypeNode = lvalue.immediateType
    // lvalueType = this.findByName(...)
    lvalueType = this.resolveType(immediateTypeNode, scope)
    // Box the type into an instance
    lvalueType = new types.Instance(lvalueType)
  }

  // Create a scope inside the Let statement for recursive calls
  var letScope = new Scope(scope)
  letScope.setLocal(name, lvalueType)

  if (node.rvalue) {
    // rvalue is an expression so let's determine its type first.
    var rvalueType = this.resolveExpression(node.rvalue, letScope, function (immediateType) {
      if (lvalueType instanceof types.Unknown) {
        // If the lvalue is unknown then annotate it with the resolved type
        lvalueType.known = new types.Instance(immediateType)
      }
    })
    if (lvalueType instanceof types.Unknown) {
      // If the lvalue was inferred then update on the lvalue
      lvalue.type = rvalueType
      scope.setLocal(name, rvalueType)
    } else {
      // If the lvalue type is explicit then make sure they match up
      if (!lvalueType.equals(rvalueType)) {
        var message = 'Unequal types in declaration: '+lvalueType.inspect()+' </> '+rvalueType.inspect()
        throw new TypeError(message, node)
      }
      scope.setLocal(name, lvalueType)
    }

  } else {
    // No rvalue present
    lvalue.type = lvalueType
    scope.setLocal(name, lvalueType)
  }
  // Now that the local is set in the parent scope we can set its flags
  // if it was a `let`-declaration
  if (node.type === 'let') {
    scope.setFlagsForLocal(name, Scope.Flags.Constant)
  }
}
// Alias the var visitor to the let visitor
TypeSystem.prototype.visitVar = TypeSystem.prototype.visitLet


TypeSystem.prototype.resolveExpression = function (expr, scope, immediate) {
  // If we've already deduced the type of this then just return it
  if (expr.type) { return expr.type }

  this.visitExpression(expr, scope, immediate)

  if (expr.type === null || expr.type === undefined) {
    throw new TypeError('Failed to resolve type')
  }
  return expr.type
}

TypeSystem.prototype.visitExpression = function (node, scope, immediate) {
  switch (node.constructor) {
    case AST.Function:
      var functionNode = <AST.Function>node
      // Sanity checks to make sure the name and when are not present
      if (functionNode.name) {
        throw new TypeError('Function expression cannot have a `name`', node)
      }
      if (functionNode.when) {
        throw new TypeError('Function expression cannot have a `when` condition', node)
      }
      // Then run the visitor
      this.visitFunction(node, scope, immediate)
      break
    case AST.Binary:
      this.visitBinary(node, scope)
      break
    case AST.Literal:
      this.visitLiteral(node, scope)
      break
    case AST.New:
      this.visitNew(node, scope)
      break
    case AST.Group:
      this.visitGroup(node, scope)
      break
    case AST.Identifier:
      this.visitIdentifier(node, scope)
      break
    default:
      throw new Error("Can't visit expression: "+node.constructor['name'])
  }
}

TypeSystem.prototype.visitLiteral = function (node: AST.Literal, scope) {
  // If we've already identified the type
  if (node.type) {
    return node.type
  } else if (node.typeName) {
    var type  = this.findByName(node.typeName)
    node.type = new types.Instance(type)
    return type
  } else {
    throw new TypeError('Unknown literal type: '+node.typeName)
  }
}

TypeSystem.prototype.visitNew = function (node: AST.New, scope) {
  // Look up the type of what we're going to construct
  var type = scope.get(node.name)
  node.constructorType = type
  // Construct an instance of that type
  var instance = new types.Instance(type)
  node.type = instance
  if (type.initializers.length === 0) {
    throw new TypeError('No initializer found for class', node)
  }
  // Unboxed types of all the arguments for comparing with the class'
  // set of initializers.
  var argTypes = new Array(node.args.length)
  // Visit all of the arguments
  for (var i = 0; i < node.args.length; i++) {
    var arg = node.args[i]
    this.visitExpression(arg, scope)
    var argType = arg.type
    if (!(argType instanceof types.Instance)) {
      throw new TypeError('Expected Instance as argument to New')
    }
    argTypes[i] = argType.type
  }
  var initializers = type.initializers,
      initializer  = false
  // Look for a matching initializer
  for (var i = initializers.length - 1; i >= 0; i--) {
    var init = initializers[i]
    var argsMatch = init.argsMatch(argTypes)
    if (argsMatch) {
      initializer = init
      break
    }
  }
  if (initializer === false) {
    throw new TypeError('No initializer not found')
  }
  node.setInitializer(initializer)
}

var COMPARATOR_OPS = ['<']

TypeSystem.prototype.visitBinary = function (node: AST.Binary, scope) {
  var lexprType = this.resolveExpression(node.lexpr, scope)
  var rexprType = this.resolveExpression(node.rexpr, scope)

  assertInstanceOf(lexprType, types.Instance, 'Expected Instance in L-value')
  assertInstanceOf(rexprType, types.Instance, 'Expected Instance in R-value')
  if (lexprType.equals(rexprType)) {
    // Naive type assignment based off left side; this is refined below
    node.type = lexprType
  } else {
    throw new TypeError('Unequal types in binary operation: '+lexprType.inspect()+' </> '+rexprType.inspect())
  }
  // TODO: Check adder, comparator, etc. interfaces of the left and right
  var op = node.op
  if (COMPARATOR_OPS.indexOf(op) !== -1) {
    node.type = this.findByName('Boolean')
  }
}

TypeSystem.prototype.getAllReturnTypes = function (block) {
  var self        = this,
      returnTypes = []
  if (block.returnType) { returnTypes.push(block.returnType) }

  block.statements.forEach(function (stmt) {
    var types = null
    switch (stmt.constructor) {
      case AST.If:
        types = self.getAllReturnTypes(stmt.block)
        if (stmt.elseBlock) {
          types = types.concat(self.getAllReturnTypes(stmt.elseBlock))
        }
        returnTypes = returnTypes.concat(types)
        break
      case AST.While:
      case AST.For:
        types = self.getAllReturnTypes(stmt.block)
        returnTypes = returnTypes.concat(types)
        break
    }
  })
  return returnTypes
}

TypeSystem.prototype.visitFunction = function (node: AST.Function, parentScope, immediate) {
  if (node.type) { return node.type }
  var self = this
  var type = new types.Function(this.rootObject)
  // Set the type of this node to an instance of the function type
  node.type = new types.Instance(type)

  if (node.ret) {
    type.ret = this.resolveType(node.ret)
  }

  // Set up a closing scope for everything in the function
  var functionScope = new ClosingScope(parentScope)
  // Save this new scope on the node object for later use
  node.scope = functionScope

  // If we have a callback for the immediate (not-yet-fully resolved type)
  // then call it now. This is also an opportunity for class and instance
  // methods to add their `this` bindings to the function's closing scope.
  if (immediate !== undefined) {
    immediate(type, functionScope)
  }

  // Build up the args to go into the type definition
  var typeArgs = [], n = 0
  node.args.forEach(function (arg) {
    // Deprecated simplistic type lookup:
    //   var argType = self.findByName(arg.type)
    if (!arg.type) {
      throw new TypeError('Missing type for argument '+n, node)
    }
    var argType = self.resolveType(arg.type)
    // Setup a local Instance in the function's scope for the argument
    functionScope.setLocal(arg.name, new types.Instance(argType))
    // Add the type to the type's args
    typeArgs.push(argType)
    n += 1
  })
  type.args = typeArgs

  // Begin by visiting our block
  this.visitBlock(node.block, functionScope)

  // Get all possible return types of this function (recursively collects
  // returning child blocks).
  var returnTypes = this.getAllReturnTypes(node.block)

  // If there is a declared return type then we need to check that all the found
  // returns match that type
  if (type.ret) {
    returnTypes.forEach(function (returnType) {
      if (!type.ret.equals(returnType)) {
        var expected = type.ret.inspect(),
            got      = returnType.inspect()

        var message = "Type returned by function does not match declared return type"
        message += ` (expected ${expected}, got ${got})`

        throw new TypeError(message)
      }
    })
    return
  }

  // Otherwise we need to try to unify the returns; this could potentially be
  // a very expensive operation, so we'll warn the user if they do too many
  if (returnTypes.length > 4) {
    var returns = returnTypes.length,
        file    = node._file,
        line    = node._line,
        warning = "Warning: Encountered "+returns+" return statements in function\n"+
                  "  Computing type unions can be expensive and should be used carefully!\n"+
                  "  at "+file+":"+line+"\n"
    process.stderr.write(warning)
  }
  // Slow quadratic uniqueness checking to reduce the set of return types
  // to distinct ones
  var reducedTypes = uniqueWithComparator(returnTypes, function (a, b) {
    return a.equals(b)
  })
  if (reducedTypes.length > 1) {
    var t = reducedTypes.map(function (t) { return t.inspect() }).join(', ')
    throw new TypeError('Too many return types (have '+t+')', node)
  }
  // Final return type
  var returnType, isReturningVoid = false;
  if (reducedTypes.length > 0) {
    returnType = reducedTypes[0]
  } else {
    isReturningVoid = true
    returnType      = this.root.getLocal('Void')
  }
  // Update the type definition (if there we 0 then it will be null which is
  // Void in the type-system)
  type.ret = returnType

  // If we know we're returning Void then check for a missing final return
  // and insert it to help the user out.
  if (isReturningVoid) {
    var lastStatement = node.block.statements[node.block.statements.length - 1]
    if (lastStatement && !(lastStatement instanceof AST.Return)) {
      // Last statement isn't a return, so let's insert one for them
      var returnStmt = new AST.Return(null)
      returnStmt.setPosition('(internal)', -1, -1)
      node.block.statements.push(returnStmt)
      this.visitReturn(returnStmt, functionScope, node.block)
      // Update the `isLastStatement` properties
      lastStatement.isLastStatement = false
      returnStmt.isLastStatement    = true
    }
  }
}//visitFunction

TypeSystem.prototype.visitMultiFunction = function (node, scope, multiNode) {
  var multiType = multiNode.type
  // Add this implementation to its list of functions and set the parent of
  // the function so that it knows not to codegen itself
  multiType.addFunctionNode(node)
  node.setParentMultiType(multiNode.type)

  // Fill out any missing types
  for (var i = 0; i < node.args.length; i++) {
    var arg = node.args[i]
    // Type is specified so we don't need to worry about it
    if (arg.type) { continue }
    // Set the argument's type to the multi argument's type
    arg.type = multiNode.args[i].type
  }

  // First run the generic function visitor
  this.visitFunction(node, scope)
  // Type-system checks
  if (typeof node.name !== 'string') {
    throw new TypeError('Non-string name for function statement', node)
  }
  assertInstanceOf(node.scope, Scope, "Missing function's scope")
  // Now do statement-level visiting
  if (node.when) {
    this.visitExpression(node.when, node.scope)
  }
}

TypeSystem.prototype.visitNamedFunction = function (node, scope) {
  this.visitFunction(node, scope)
  scope.setLocal(node.name, node.type)
}

TypeSystem.prototype.visitFunctionStatement = function (node: AST.Function, scope, searchInParent) {
  var name = node.name
  // Now look up the parent `multi` in the containing block
  var multiNode = searchInParent(function (stmt) {
    if (stmt.constructor === AST.Multi && stmt.name === name) {
      return true
    }
    return false
  })
  if (multiNode) {
    this.visitMultiFunction(node, scope, multiNode)
  } else {
    this.visitNamedFunction(node, scope)
  }
}


// Resolve an Unknown type to a known one (sort of a second pass) or throw
// an error if it's still unknown
var know = function (node, type) {
  if (type instanceof types.Unknown) {
    if (type.known === null) {
      throw new TypeError('Unknown type')
    }
    return type.known
  }
  return type
}

TypeSystem.prototype.visitChild = function (node: AST.Node, child: AST.Node, scope) {
  switch (child.constructor) {
    case AST.Identifier:
      this.visitIdentifier(child, scope)
      break
    case AST.Call:
      this.visitCall(child, scope)
      break
    case AST.Indexer:
      this.visitIndexer(child, scope)
      break
    default:
      throw new TypeError("Can't visit child: "+node.constructor['name'])
  }
}

TypeSystem.prototype.visitIdentifier = function (node: AST.Identifier, scope) {
  if (node.parent) {
    var parentType = node.parent.type
    node.type = this.getTypeOfTypesProperty(parentType, node.name)
  } else {
    node.type = scope.get(node.name)
  }

  // Don't need to do anything more if there's not a child
  if (!node.child) { return }

  var child = node.child
  this.visitChild(node, child, scope)

  // Now compute the ultimate type
  node.initialType = node.type
  node.type        = getUltimateType(node)
}

function getUltimateType (root: AST.PathRoot): types.Type {
  var child = root.child

  // Descend down the chain
  while (true) {
    if (child.child) {
      child = child.child
    } else {
      break
    }
  }

  if (!child || !child.type) {
    var name = root.constructor['name']
    throw new TypeError(`Missing child type for ultimate root ${name} type`)
  }
  return child.type
}

TypeSystem.prototype.visitCall = function (node: AST.Call, scope) {
  if (!node.parent) {
    throw new TypeError("Call must have parent")
  }

  var parent = node.parent,
      parentType = parent.type

  // Must be calling an instance
  assertInstanceOf(parentType, types.Instance, 'Expected Instance for function of Call')
  // Unbox and check that it is a function
  var functionType = parentType.type
  assertInstanceOf(functionType, types.Function, 'Expected Function for unboxed function of Call')

  var args     = node.args,
      typeArgs = functionType.args
  // Basic length check
  if (args.length !== typeArgs.length) {
    throw new TypeError("Argument length mismatch, expected: "+typeArgs.length+", got: "+args.length)
  }
  // Item-wise compare the arguments (given) with the parameters (expected)
  for (var i = 0; i < typeArgs.length; i++) {
    var arg = args[i]
    this.visitExpression(arg, scope)
    // Get the type of the argument (from the caller) and the parameter (from
    // the function's definition).
    var argTy = arg.type,
        parTy = typeArgs[i]
    assertInstanceOf(argTy, types.Instance, "Expected Instance as function argument, got: "+argTy.inspect)
    // Unbox the instance
    argTy = argTy.type
    if (!parTy.equals(argTy)) {
      var e = parTy.inspect(),
          g = argTy.inspect()
      throw new TypeError("Argument type mismatch at parameter "+(i+1)+", expected: "+e+", got: "+g)
    }
  }
  node.type = new types.Instance(functionType.ret)

  if (node.child) {
    this.visitChild(node, node.child, scope)
  }
}

TypeSystem.prototype.visitGroup = function (node: AST.Group, scope: scope.Scope) {
  this.visitExpression(node.expr, scope)
    node.type = node.expr.type

  if (node.child) {
    this.visitChild(node, node.child, scope)

    node.initialType = node.expr.type
    node.type        = getUltimateType(node)
  }
}



// Utility function for resolving the type of a type's property. Handles
// either Modules or Instances of a type; for everything else it will
// throw an error.
TypeSystem.prototype.getTypeOfTypesProperty = function (type, name) {
  var returnType = null
  if (type instanceof types.Module) {
    // pass
  } else {
    var typeName = (type ? type.inspect() : String(type))
    assertInstanceOf(type, types.Instance, 'Trying to get property of non-Instance: '+typeName)
    var instance: types.Instance = type
    // Unbox the instance
    type = instance.type
  }
  returnType = type.getTypeOfProperty(name)
  // If it's another Module then just return that
  if (returnType instanceof types.Module) {
    return returnType
  }
  // Otherwise box it into an instance
  return new types.Instance(returnType)
}


TypeSystem.prototype.visitMulti = function (node: AST.Multi, scope) {
  var self = this
  // Construct a new array of name-type args
  var args = node.args.map(function (arg) {
    var name = arg.name,
        type = self.resolveType(arg.type)
    return {name: name, type: type}
  })
  if (!node.ret) {
    throw new TypeError('Missing multi return type', node)
  }
  var ret = this.resolveType(node.ret)
  // Construct Multi type with the arguments and return types
  var multi = new types.Multi(this.rootObject, args, ret)
  node.type = multi
  // Add multi to the scope
  scope.setLocal(node.name, multi)
}


module.exports = {TypeSystem: TypeSystem}

