import ballerina/graphql;

type Book record {|
    string title;
|};

type Author record {|
    string name;
|};

type BookNotFound distinct error;

type BookOrError Book|error;

// Resolver errors in each shape a field can be written in. An error goes to the response's `errors` list, so it never
// changes the field's type; only a nil does.
listener graphql:Listener booksListener = new (9097);

service /books on booksListener {

    resource function get book() returns Book|error {
        return {title: ""};
    }

    // `error?` is the anonymous union `error|()`: its nil makes the field nullable, its error is dropped.
    resource function get maybeBook() returns Book|error? {
        return ();
    }

    resource function get nullableFirst() returns Book?|error {
        return ();
    }

    resource function get books() returns Book[]|error? {
        return ();
    }

    resource function get byTitle(string title) returns Book|BookNotFound {
        return {title};
    }

    resource function get aliased() returns BookOrError {
        return {title: ""};
    }

    resource function get greeting() returns string|error? {
        return ();
    }

    resource function get bookOrAuthor() returns Book|Author|error? {
        return ();
    }

    remote function addBook(string title) returns Book|error? {
        return ();
    }

    resource function subscribe newBooks() returns stream<Book, error?>|error {
        return [].toStream();
    }
}
