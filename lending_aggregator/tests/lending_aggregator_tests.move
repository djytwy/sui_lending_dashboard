#[test_only]
module lending_aggregator::lending_aggregator_tests;

use lending_aggregator::protocols;

#[test]
fun protocol_ids_are_stable() {
    assert!(protocols::navi() == 1);
    assert!(protocols::scallop() == 2);
    assert!(protocols::suilend() == 3);
    assert!(protocols::bucket() == 4);
}
