"""`@ui` and `Param`: what the decorator records, and what it refuses.

Imported directly like the inspector, because it runs inside the kernel: the
function it decorates is the user's, and the only thing it produces is `fn.ui`.
"""

import inspect
import unittest

from build123d_studio import Param, ui


class UiDecoratorTest(unittest.TestCase):
    def test_type_and_default_come_from_the_signature(self):
        """So they are written once. The Param carries only what the signature cannot."""

        @ui({"Stand": {"length": Param(desc="Length", choice={"long": 70, "short": 30})}})
        def model(length: int = 50, wanted: bool = True):
            return length

        self.assertEqual(
            model.ui["length"],
            (int, 50, "Stand", Param(desc="Length", choice={"long": 70, "short": 30})),
        )

    def test_a_param_at_the_top_level_is_ungrouped(self):
        """The group is the pane's heading and nothing else: not a property of the Param."""

        @ui({"count": Param(interval=(3, 14)), "Stand": {"length": Param()}})
        def model(length: int = 50, count: int = 7):
            return length

        self.assertEqual(model.ui["count"], (int, 7, "", Param(interval=(3, 14))))
        self.assertEqual(model.ui["length"], (int, 50, "Stand", Param()))

    def test_the_spec_decides_the_order_and_what_is_in_the_pane(self):
        """A parameter with a default that the spec leaves out keeps its default: the pane's
        call names only what it shows."""

        @ui({"B": {"b": Param(desc="B")}, "A": {"a": Param(desc="A")}})
        def model(a: int = 1, b: int = 2, c: int = 3):
            return a

        self.assertEqual(list(model.ui), ["b", "a"])

    def test_a_parameter_without_a_default_must_be_in_the_spec(self):
        """Nothing could fill it in otherwise."""
        with self.assertRaises(TypeError) as raised:

            @ui({"a": Param()})
            def model(a: int, b: float):
                return a

        self.assertIn("'b'", str(raised.exception))
        self.assertIn("without a default", str(raised.exception))

    def test_the_function_is_returned_as_it_was(self):
        """Removing the decorator changes nothing about the function; adding it, only `ui`."""

        def plain(a: int = 1):
            return a * 2

        decorated = ui({})(plain)
        self.assertIs(decorated, plain)
        self.assertEqual(decorated(4), 8)
        self.assertEqual(inspect.signature(decorated), inspect.signature(plain))

    def test_a_name_that_is_not_a_parameter_is_refused_at_definition(self):
        """The one weak point of keying by string, closed: a typo cannot leave a widget silently missing."""
        with self.assertRaises(TypeError) as raised:

            @ui({"Stand": {"lenght": Param()}})
            def model(length: int = 50):
                return length

        self.assertIn("lenght", str(raised.exception))
        self.assertIn("model", str(raised.exception))

    def test_a_parameter_listed_under_two_groups_is_refused(self):
        with self.assertRaises(TypeError) as raised:
            ui({"A": {"x": Param()}, "B": {"x": Param()}})
        self.assertIn("twice", str(raised.exception))

    def test_a_value_that_is_neither_a_group_nor_a_param_is_refused(self):
        with self.assertRaises(TypeError):
            ui({"x": 5})
        with self.assertRaises(TypeError):
            ui({"Stand": {"x": "Length"}})

    def test_step_is_one_unless_the_param_says_otherwise(self):
        @ui({"a": Param(), "b": Param(step=0.25)})
        def model(a: int = 1, b: float = 2.0):
            return a

        self.assertEqual(model.ui["a"][3].step, 1)
        self.assertEqual(model.ui["b"][3].step, 0.25)

    def test_a_parameter_without_a_default_is_recorded_as_such(self):
        @ui({"length": Param()})
        def model(length: int):
            return length

        self.assertIs(model.ui["length"][1], inspect.Parameter.empty)


if __name__ == "__main__":
    unittest.main()
