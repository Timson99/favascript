module.exports.getAst = function() {
    return `(Program
  (Block
    (=
      (IdExpression
        (ConstId
          (PI)
        )
      )
      (3.1415926)
    )
  )
)`;
}
