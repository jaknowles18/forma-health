"""A deliberately small ridge-regression implementation for learning."""


def solve_linear_system(matrix: list[list[float]], vector: list[float]) -> list[float] | None:
    """Solve Ax=b with Gaussian elimination and partial pivoting."""
    rows = [row[:] + [vector[index]] for index, row in enumerate(matrix)]
    for column in range(len(rows)):
        pivot = max(range(column, len(rows)), key=lambda row: abs(rows[row][column]))
        rows[column], rows[pivot] = rows[pivot], rows[column]
        if abs(rows[column][column]) < 1e-10:
            return None

        divisor = rows[column][column]
        rows[column] = [value / divisor for value in rows[column]]
        for row_index, row in enumerate(rows):
            if row_index == column:
                continue
            factor = row[column]
            rows[row_index] = [
                value - factor * rows[column][cell]
                for cell, value in enumerate(row)
            ]
    return [row[-1] for row in rows]


def fit_ridge(rows: list[dict], feature_count: int, regularization: float = 1.5) -> dict:
    """Fit β=(XᵀX + λI)⁻¹Xᵀy without hiding the matrix operations.

    Ridge regularization shrinks unstable coefficients, which is useful when a
    personal dataset is small or health features move together.
    """
    width = feature_count + 1  # one extra column for the intercept
    matrix = [[0.0 for _ in range(width)] for _ in range(width)]
    vector = [0.0 for _ in range(width)]
    for row in rows:
        x = [1.0, *row["values"]]
        for i in range(width):
            vector[i] += x[i] * row["target"]
            for j in range(width):
                matrix[i][j] += x[i] * x[j]

    # The intercept represents the overall average and is not penalized.
    for index in range(1, width):
        matrix[index][index] += regularization
    coefficients = solve_linear_system(matrix, vector)
    if coefficients is None:
        raise ValueError("The model matrix could not be solved.")
    return {"intercept": coefficients[0], "weights": coefficients[1:]}


def predict(model: dict, values: list[float]) -> float:
    return model["intercept"] + sum(weight * value for weight, value in zip(model["weights"], values))
